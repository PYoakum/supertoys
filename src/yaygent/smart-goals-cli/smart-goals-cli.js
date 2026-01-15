#!/usr/bin/env bun
/**
 *
 * Adds:
 * - --ai-edit with include/exclude globs (+ include-context)
 * - LLM retries w/ backoff + jitter
 * - LLM protocol: ndjson | json | sse
 * - --on-success "<cmd>" post-run hook
 * - audit + debug logs (debug captures raw streamed response)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import readline from "node:readline";
import { pathToFileURL } from "node:url";

const APP_DIR = path.resolve(process.cwd(), ".goals-cli");
const PROJECT_PATH = path.join(APP_DIR, "project.json");
const GOALS_PATH = path.join(APP_DIR, "goals.json");
const LOG_DIR = path.join(APP_DIR, "logs");
const AUDIT_LOG_PATH = path.join(LOG_DIR, "audit.jsonl");

function usage(exitCode = 0) {
  const msg = `
Goals CLI (Bun)

Usage:
  bun cli.js init
  bun cli.js add [--json <goalJson>] [--id <id> --objective <text> --priority <n> --success <s>...]
  bun cli.js list
  bun cli.js remove <id>
  bun cli.js edit <id>
  bun cli.js export [--out export.json] [--stdout] [--ai-edit ...]
  bun cli.js set <path> <value>

Import / external sources:
  bun cli.js import --file <config.(json|js|py)>
  bun cli.js import --url <https://...>

  bun cli.js meta  --json <metadataJson> | --file <meta.(json|js|py)> | --url <https://...> [--merge|--replace]
  bun cli.js goals --file <goals.(json|js|py)> | --url <https://...> [--replace]

AI edit:
  bun cli.js ai-edit --llm-url <https://...> [--llm-protocol ndjson|json|sse] [--llm-model <str>]
                   [--llm-batch-size N] [--llm-timeout-ms N]
                   [--llm-retries N] [--llm-backoff-ms N] [--llm-backoff-max-ms N]
                   [--ai-edit-include <glob>...] [--ai-edit-exclude <glob>...]
                   [--ai-edit-include-context]
                   [--debug]

Common flags:
  --debug
  --on-success "<command>" (repeatable)

LLM contract (generic):
  POST JSON: { model, prompt, items:[{path,text},...] }

Response parsing:
  --llm-protocol ndjson:
    Stream lines: {"path":"...","text":"..."}
  --llm-protocol sse:
    text/event-stream lines, where each event may include:
      data: {"path":"...","text":"..."}
    or:
      data: {"items":[{"path","text"},...]}
  --llm-protocol json:
    {"items":[{"path","text"},...]}

Examples:
  bun cli.js export --ai-edit --llm-url https://llm.example.com/v1/edit --llm-protocol ndjson --debug
  bun cli.js ai-edit --llm-url https://llm.example.com/v1/edit --llm-protocol sse --ai-edit-include 'goals[*].objective'
`.trim();
  console.log(msg);
  process.exit(exitCode);
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function readJson(p, fallback) {
  if (!fs.existsSync(p)) return fallback;
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf-8");
}

function nowIso() {
  return new Date().toISOString();
}

function defaultProjectTemplate() {
  return {
    version: "1.0",
    metadata: {
      name: "{PROJECT-NAME}",
      description: "{PROJECT-DESCRIPTION}",
      author: "development-team",
      created: nowIso(),
      tags: ["authentication", "security", "mvp"],
    },
    globalContext: {
      projectName: "AuthSystem",
      targetEnvironment: "production",
      runtime: "Bun",
    },
  };
}

function normalizeGoal(goal) {
  const out = { ...goal };

  if (!out.id || typeof out.id !== "string") throw new Error("Goal.id is required (string).");
  if (!out.objective || typeof out.objective !== "string") throw new Error("Goal.objective is required (string).");
  if (typeof out.priority !== "number" || !Number.isFinite(out.priority)) throw new Error("Goal.priority is required (number).");
  if (!out.criteria || typeof out.criteria !== "object") throw new Error("Goal.criteria is required (object).");

  if (out.criteria.success && !Array.isArray(out.criteria.success)) throw new Error("criteria.success must be string[].");
  if (out.criteria.acceptance && !Array.isArray(out.criteria.acceptance)) throw new Error("criteria.acceptance must be string[].");
  if (out.criteria.validation && typeof out.criteria.validation !== "string") throw new Error("criteria.validation must be string.");

  if (out.dependencies && !Array.isArray(out.dependencies)) throw new Error("dependencies must be string[].");
  if (out.constraints && !Array.isArray(out.constraints)) throw new Error("constraints must be string[].");
  if (out.context && (typeof out.context !== "object" || Array.isArray(out.context))) throw new Error("context must be an object.");

  if (Array.isArray(out.dependencies) && out.dependencies.length === 0) delete out.dependencies;
  if (Array.isArray(out.constraints) && out.constraints.length === 0) delete out.constraints;
  if (out.context && Object.keys(out.context).length === 0) delete out.context;

  return out;
}

function loadState() {
  if (!fs.existsSync(APP_DIR)) throw new Error(`Missing ${APP_DIR}. Run: bun cli.js init`);
  const project = readJson(PROJECT_PATH, null);
  const goals = readJson(GOALS_PATH, null);
  if (!project) throw new Error(`Missing ${PROJECT_PATH}. Run: bun cli.js init`);
  if (!Array.isArray(goals)) throw new Error(`Missing or invalid ${GOALS_PATH}. Run: bun cli.js init`);
  return { project, goals };
}

function saveState(project, goals) {
  writeJson(PROJECT_PATH, project);
  writeJson(GOALS_PATH, goals);
}

function rlPrompt() {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

function question(rl, q) {
  return new Promise((resolve) => rl.question(q, (ans) => resolve(ans)));
}

async function promptList(rl, label) {
  console.log(`Enter ${label} items one per line. Submit an empty line to finish.`);
  const items = [];
  while (true) {
    const ans = (await question(rl, "> ")).trim();
    if (!ans) break;
    items.push(ans);
  }
  return items;
}

async function promptYesNo(rl, q, def = false) {
  const suffix = def ? " [Y/n] " : " [y/N] ";
  const ans = (await question(rl, q + suffix)).trim().toLowerCase();
  if (!ans) return def;
  return ans === "y" || ans === "yes";
}

/* -------------------------- Logging -------------------------- */

function initLogs(debugEnabled) {
  ensureDir(LOG_DIR);
  if (!fs.existsSync(AUDIT_LOG_PATH)) fs.writeFileSync(AUDIT_LOG_PATH, "", "utf-8");
  const debugPath = debugEnabled ? path.join(LOG_DIR, `debug-${Date.now()}.log`) : null;
  if (debugPath) fs.writeFileSync(debugPath, "", "utf-8");
  return { debugPath };
}

function audit(event) {
  ensureDir(LOG_DIR);
  fs.appendFileSync(AUDIT_LOG_PATH, JSON.stringify({ ts: nowIso(), ...event }) + "\n", "utf-8");
}

function debugWrite(debugPath, chunk) {
  if (!debugPath) return;
  fs.appendFileSync(debugPath, chunk, "utf-8");
}

/* -------------------------- Source loading (url/file/js/py/json) -------------------------- */

async function loadObjectFromUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed (${res.status}) for ${url}`);
  return await res.json();
}

async function loadObjectFromFile(filePath) {
  const abs = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(abs)) throw new Error(`File not found: ${abs}`);

  const ext = path.extname(abs).toLowerCase();
  if (ext === ".json") return JSON.parse(fs.readFileSync(abs, "utf-8"));

  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") {
    const url = pathToFileURL(abs);
    url.searchParams.set("t", String(Date.now()));
    const mod = await import(url.href);
    const obj = mod?.default ?? mod;
    if (obj == null || typeof obj !== "object") throw new Error(`JS config did not export an object: ${abs}`);
    return obj;
  }

  if (ext === ".py") {
    const proc = Bun.spawn({ cmd: ["python3", abs], stdout: "pipe", stderr: "pipe" });
    const out = await new Response(proc.stdout).text();
    const err = await new Response(proc.stderr).text();
    const code = await proc.exited;
    if (code !== 0) throw new Error(`Python config failed (${code}). stderr:\n${err || "(empty)"}`);
    try {
      return JSON.parse(out);
    } catch {
      throw new Error(`Python config did not output valid JSON.\nstdout:\n${out}`);
    }
  }

  throw new Error(`Unsupported config file type: ${ext} (supported: .json, .js/.mjs/.cjs, .py)`);
}

async function loadFromSource({ json, file, url }) {
  if (json) {
    try {
      return JSON.parse(json);
    } catch {
      throw new Error("Invalid JSON string provided.");
    }
  }
  if (url) return await loadObjectFromUrl(url);
  if (file) return await loadObjectFromFile(file);
  throw new Error("No source provided (use --json, --file, or --url).");
}

function coerceConfigToProjectGoals(obj) {
  if (obj == null || typeof obj !== "object") throw new Error("Config must be an object.");
  if (!Array.isArray(obj.goals)) throw new Error('Config must include "goals": []');

  if (obj.project && typeof obj.project === "object") return { project: obj.project, goals: obj.goals };
  if (obj.template && typeof obj.template === "object") return { project: obj.template, goals: obj.goals };

  if (obj.metadata && typeof obj.metadata === "object" && !obj.version && !obj.globalContext) {
    const project = defaultProjectTemplate();
    project.metadata = { ...project.metadata, ...obj.metadata };
    return { project, goals: obj.goals };
  }

  const { goals, ...rest } = obj;
  return { project: rest, goals };
}

/* -------------------------- Path helpers -------------------------- */

function parsePathExpr(expr) {
  const tokens = [];
  let i = 0;
  while (i < expr.length) {
    if (expr[i] === ".") { i++; continue; }
    if (expr[i] === "[") {
      const close = expr.indexOf("]", i);
      if (close === -1) throw new Error(`Invalid path (missing ]): ${expr}`);
      const inside = expr.slice(i + 1, close);
      const idx = Number(inside);
      if (!Number.isInteger(idx)) throw new Error(`Invalid array index in path: ${expr}`);
      tokens.push(idx);
      i = close + 1;
      continue;
    }
    let j = i;
    while (j < expr.length && expr[j] !== "." && expr[j] !== "[") j++;
    tokens.push(expr.slice(i, j));
    i = j;
  }
  return tokens;
}

function getByPath(obj, expr) {
  const tokens = parsePathExpr(expr);
  let cur = obj;
  for (const t of tokens) {
    if (cur == null) return undefined;
    cur = cur[t];
  }
  return cur;
}

function setByPathExpr(obj, expr, value) {
  const tokens = parsePathExpr(expr);
  if (!tokens.length) throw new Error("Empty path");
  let cur = obj;
  for (let i = 0; i < tokens.length - 1; i++) {
    const t = tokens[i];
    const nxt = tokens[i + 1];
    if (cur[t] == null) cur[t] = typeof nxt === "number" ? [] : {};
    cur = cur[t];
  }
  cur[tokens[tokens.length - 1]] = value;
}

/* -------------------------- Glob filtering -------------------------- */

function globToRegExp(glob) {
  // Escape regex, then replace wildcards:
  //  * => .*   ? => .
  // Also allow literal [] in paths; we escape everything first.
  const esc = glob.replace(/[-/\\^$+?.()|{}]/g, "\\$&");
  const re = "^" + esc.replaceAll("\\*", ".*").replaceAll("\\?", ".") + "$";
  return new RegExp(re);
}

function normalizeGlob(glob) {
  // convenience: convert "goals[*]" into "goals[\\d+]"? we do wildcard to .* anyway.
  return glob;
}

function matchAny(globs, pathStr) {
  if (!globs || globs.length === 0) return false;
  return globs.some((g) => globToRegExp(normalizeGlob(g)).test(pathStr));
}

function shouldIncludePath(pathStr, includeGlobs, excludeGlobs) {
  if (excludeGlobs && excludeGlobs.length && matchAny(excludeGlobs, pathStr)) return false;
  if (includeGlobs && includeGlobs.length) return matchAny(includeGlobs, pathStr);
  return true; // default include if no include list
}

/* -------------------------- AI edit: collect strings -------------------------- */

function collectContentStringPaths(project, goals, includeContext) {
  const paths = [];

  // metadata
  const meta = project?.metadata || {};
  if (typeof meta.name === "string") paths.push("project.metadata.name");
  if (typeof meta.description === "string") paths.push("project.metadata.description");
  if (typeof meta.author === "string") paths.push("project.metadata.author");
  if (Array.isArray(meta.tags)) {
    meta.tags.forEach((v, i) => { if (typeof v === "string") paths.push(`project.metadata.tags[${i}]`); });
  }

  // goals (human-facing)
  goals.forEach((g, gi) => {
    if (typeof g.objective === "string") paths.push(`goals[${gi}].objective`);

    if (Array.isArray(g.constraints)) {
      g.constraints.forEach((v, i) => { if (typeof v === "string") paths.push(`goals[${gi}].constraints[${i}]`); });
    }

    if (g.criteria) {
      if (Array.isArray(g.criteria.success)) {
        g.criteria.success.forEach((v, i) => { if (typeof v === "string") paths.push(`goals[${gi}].criteria.success[${i}]`); });
      }
      if (Array.isArray(g.criteria.acceptance)) {
        g.criteria.acceptance.forEach((v, i) => { if (typeof v === "string") paths.push(`goals[${gi}].criteria.acceptance[${i}]`); });
      }
      if (typeof g.criteria.validation === "string") paths.push(`goals[${gi}].criteria.validation`);
    }

    if (includeContext && g.context && typeof g.context === "object" && !Array.isArray(g.context)) {
      // Include string values and string arrays within context
      for (const [k, v] of Object.entries(g.context)) {
        const base = `goals[${gi}].context.${k}`;
        if (typeof v === "string") paths.push(base);
        else if (Array.isArray(v)) {
          v.forEach((vv, i) => { if (typeof vv === "string") paths.push(`${base}[${i}]`); });
        }
      }
    }
  });

  return paths;
}

function buildAiPrompt() {
  return [
    "You will receive a list of content strings from a project plan.",
    "Task: compress and simplify each string while minimizing context loss.",
    "Rules:",
    "- Preserve meaning, requirements, constraints, and technical specificity.",
    "- Remove redundancy and filler.",
    "- Do NOT add new requirements or remove important details.",
    "- Keep identifiers/acronyms/proper nouns intact.",
    "- Output only rewritten strings mapped to the same `path` values.",
    "Output format depends on protocol:",
    "- NDJSON: one JSON per line: {\"path\":\"...\",\"text\":\"...\"}",
    "- SSE: send data: {\"path\":\"...\",\"text\":\"...\"} per event (or one event with {\"items\":[...]}).",
    "- JSON: {\"items\":[{\"path\":\"...\",\"text\":\"...\"}, ...]}",
  ].join("\n");
}

/* -------------------------- LLM fetch with timeout + retries -------------------------- */

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function jitter(ms) {
  // +/- 25%
  const delta = ms * 0.25;
  return Math.max(0, ms + (Math.random() * 2 - 1) * delta);
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetries({ url, init, timeoutMs, retries, backoffMs, backoffMaxMs, debugPath, batchIndex }) {
  let attempt = 0;
  let wait = backoffMs;

  while (true) {
    attempt++;
    audit({ kind: "llm_request_attempt", batchIndex, attempt });

    try {
      const res = await fetchWithTimeout(url, init, timeoutMs);
      if (res.ok) return res;

      const text = await res.text().catch(() => "");
      debugWrite(debugPath, `\n--- llm http error batch=${batchIndex} attempt=${attempt} status=${res.status} ---\n${text}\n`);

      // Retry on 429/5xx
      if ((res.status === 429 || (res.status >= 500 && res.status <= 599)) && attempt <= retries) {
        const w = jitter(Math.min(wait, backoffMaxMs));
        audit({ kind: "llm_retry_wait", batchIndex, attempt, waitMs: Math.round(w), status: res.status });
        await sleep(w);
        wait *= 2;
        continue;
      }

      throw new Error(`LLM endpoint error (${res.status})`);
    } catch (e) {
      // AbortError / network errors should retry too
      const msg = e?.message || String(e);
      debugWrite(debugPath, `\n--- llm fetch error batch=${batchIndex} attempt=${attempt} ---\n${msg}\n`);

      if (attempt <= retries) {
        const w = jitter(Math.min(wait, backoffMaxMs));
        audit({ kind: "llm_retry_wait", batchIndex, attempt, waitMs: Math.round(w), error: msg });
        await sleep(w);
        wait *= 2;
        continue;
      }

      throw e;
    }
  }
}

/* -------------------------- Streaming parsers -------------------------- */

function parseNdjsonLinesFromBuffer(buf, onObj, debugPath) {
  while (true) {
    const nl = buf.indexOf("\n");
    if (nl === -1) break;
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    try {
      const obj = JSON.parse(line);
      onObj(obj);
    } catch {
      debugWrite(debugPath, `\n[ndjson parse skip]\n${line}\n`);
    }
  }
  return buf;
}

function parseSseEventsFromBuffer(buf, onEvent, debugPath) {
  // SSE events separated by blank line
  while (true) {
    const sep = buf.indexOf("\n\n");
    if (sep === -1) break;
    const rawEvent = buf.slice(0, sep);
    buf = buf.slice(sep + 2);

    const lines = rawEvent.split("\n");
    const dataLines = [];
    for (const line of lines) {
      const trimmed = line.replace(/\r$/, "");
      if (trimmed.startsWith("data:")) {
        dataLines.push(trimmed.slice(5).trimStart());
      }
    }
    const data = dataLines.join("\n").trim();
    if (!data) continue;
    onEvent(data);
  }
  return buf;
}

/* -------------------------- AI edit core -------------------------- */

async function aiEditStrings(opts, items) {
  const {
    llmUrl, protocol, model, batchSize, timeoutMs,
    retries, backoffMs, backoffMaxMs,
    includeGlobs, excludeGlobs, includeContext,
    debugPath
  } = opts;

  const prompt = buildAiPrompt();
  const results = new Map();

  // batch
  const batches = [];
  for (let i = 0; i < items.length; i += batchSize) batches.push(items.slice(i, i + batchSize));

  audit({
    kind: "ai_edit_start",
    llmUrl, protocol, model,
    batchSize, timeoutMs,
    retries, backoffMs, backoffMaxMs,
    itemCount: items.length,
    batchCount: batches.length,
    includeContext,
    includeGlobs: includeGlobs || [],
    excludeGlobs: excludeGlobs || []
  });

  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi];

    const body = JSON.stringify({ model, prompt, items: batch });
    audit({ kind: "ai_edit_batch_request", batchIndex: bi, batchSize: batch.length });

    const res = await fetchWithRetries({
      url: llmUrl,
      init: { method: "POST", headers: { "content-type": "application/json" }, body },
      timeoutMs,
      retries,
      backoffMs,
      backoffMaxMs,
      debugPath,
      batchIndex: bi,
    });

    if (protocol === "json") {
      const raw = await res.text();
      debugWrite(debugPath, `\n--- ai batch ${bi} raw json ---\n${raw}\n`);
      const parsed = JSON.parse(raw);
      const outItems = parsed?.items;
      if (!Array.isArray(outItems)) throw new Error(`LLM JSON response missing items[] on batch ${bi}`);
      for (const it of outItems) {
        if (it && typeof it.path === "string" && typeof it.text === "string") results.set(it.path, it.text);
      }
      audit({ kind: "ai_edit_batch_complete", batchIndex: bi, received: outItems.length });
      continue;
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error("LLM response body not readable (no stream).");

    const decoder = new TextDecoder();
    let buf = "";
    let received = 0;

    const onObj = (obj) => {
      if (obj && typeof obj.path === "string" && typeof obj.text === "string") {
        results.set(obj.path, obj.text);
        received++;
      }
      if (obj && Array.isArray(obj.items)) {
        for (const it of obj.items) {
          if (it && typeof it.path === "string" && typeof it.text === "string") {
            results.set(it.path, it.text);
            received++;
          }
        }
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunkText = decoder.decode(value, { stream: true });

      // raw capture
      debugWrite(debugPath, chunkText);
      buf += chunkText;

      if (protocol === "ndjson") {
        buf = parseNdjsonLinesFromBuffer(buf, onObj, debugPath);
      } else if (protocol === "sse") {
        buf = parseSseEventsFromBuffer(
          buf,
          (dataStr) => {
            try {
              const obj = JSON.parse(dataStr);
              onObj(obj);
            } catch {
              // sometimes endpoints send bare strings; ignore safely
              debugWrite(debugPath, `\n[sse data parse skip]\n${dataStr}\n`);
            }
          },
          debugPath
        );
      } else {
        throw new Error(`Unsupported protocol: ${protocol}`);
      }
    }

    const tail = buf.trim();
    if (tail) {
      // Best effort tail parse
      try {
        if (protocol === "ndjson") {
          const obj = JSON.parse(tail);
          onObj(obj);
        } else if (protocol === "sse") {
          // attempt parsing last 'data:' block
          const lastDataLine = tail.split("\n").find((l) => l.startsWith("data:"));
          if (lastDataLine) {
            const dataStr = lastDataLine.slice(5).trimStart();
            const obj = JSON.parse(dataStr);
            onObj(obj);
          }
        }
      } catch {
        debugWrite(debugPath, `\n[stream tail parse skip]\n${tail}\n`);
      }
    }

    audit({ kind: "ai_edit_batch_complete", batchIndex: bi, received });
  }

  audit({ kind: "ai_edit_complete", received: results.size });
  return results;
}

function applyAiEditsToState(project, goals, editsMap) {
  let replaced = 0;
  const root = { project, goals };

  for (const [p, text] of editsMap.entries()) {
    const current = getByPath(root, p);
    if (typeof current === "string" && typeof text === "string") {
      if (current !== text) replaced++;
      setByPathExpr(root, p, text);
    }
  }

  audit({ kind: "ai_edit_applied", replaced });
  return { project: root.project, goals: root.goals };
}

/* -------------------------- On-success runner -------------------------- */

function normalizeOnSuccess(flags) {
  const v = flags["on-success"];
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

async function runOnSuccess(commands, vars, debugPath) {
  for (const cmd of commands) {
    const expanded = cmd
      .replaceAll("{export_path}", vars.export_path || "")
      .replaceAll("{project_path}", vars.project_path || "")
      .replaceAll("{goals_path}", vars.goals_path || "");

    audit({ kind: "on_success_start", command: expanded });

    const proc = Bun.spawn({ cmd: ["/bin/sh", "-lc", expanded], stdout: "pipe", stderr: "pipe" });
    const out = await new Response(proc.stdout).text();
    const err = await new Response(proc.stderr).text();
    const code = await proc.exited;

    debugWrite(debugPath, `\n--- on-success command ---\n${expanded}\n--- stdout ---\n${out}\n--- stderr ---\n${err}\n--- exit ${code} ---\n`);

    if (code !== 0) {
      audit({ kind: "on_success_error", command: expanded, exitCode: code });
      throw new Error(`on-success command failed (exit ${code})`);
    }

    audit({ kind: "on_success_complete", command: expanded, exitCode: code });
  }
}

/* -------------------------- AI edit command / flag behavior -------------------------- */

function toArrayFlag(v) {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

function parseAiOpts(flags) {
  const llmUrl = flags["llm-url"];
  if (!llmUrl) throw new Error("Missing --llm-url for --ai-edit.");

  const protocol = String(flags["llm-protocol"] || "ndjson").toLowerCase();
  if (!["ndjson", "json", "sse"].includes(protocol)) throw new Error("--llm-protocol must be ndjson, json, or sse");

  const model = flags["llm-model"] || "generic";
  const batchSize = Number(flags["llm-batch-size"] || 24);
  const timeoutMs = Number(flags["llm-timeout-ms"] || 120000);

  const retries = Number(flags["llm-retries"] || 3);
  const backoffMs = Number(flags["llm-backoff-ms"] || 500);
  const backoffMaxMs = Number(flags["llm-backoff-max-ms"] || 8000);

  const includeGlobs = toArrayFlag(flags["ai-edit-include"]);
  const excludeGlobs = toArrayFlag(flags["ai-edit-exclude"]);
  const includeContext = !!flags["ai-edit-include-context"];

  return { llmUrl, protocol, model, batchSize, timeoutMs, retries, backoffMs, backoffMaxMs, includeGlobs, excludeGlobs, includeContext };
}

async function cmdAiEdit(flags, logCtx) {
  const { project, goals } = loadState();

  const ai = parseAiOpts(flags);
  const paths = collectContentStringPaths(project, goals, ai.includeContext);

  const root = { project, goals };
  const candidates = paths
    .filter((p) => shouldIncludePath(p, ai.includeGlobs, ai.excludeGlobs))
    .map((p) => ({ path: p, text: getByPath(root, p) }))
    .filter((it) => typeof it.text === "string" && it.text.trim().length > 0);

  if (candidates.length === 0) {
    audit({ kind: "ai_edit_skip", reason: "no_candidates" });
    console.log("AI edit: no matching content strings found (check include/exclude globs).");
    return;
  }

  debugWrite(logCtx.debugPath, `\n--- ai-edit start ---\nprotocol=${ai.protocol}\nitems=${candidates.length}\n`);

  const edits = await aiEditStrings({ ...ai, debugPath: logCtx.debugPath }, candidates);

  const next = applyAiEditsToState(project, goals, edits);
  saveState(next.project, next.goals);

  audit({ kind: "ai_edit_saved", itemCount: candidates.length, editedCount: edits.size });
  console.log(`AI edit complete. Updated ${edits.size}/${candidates.length} strings.`);
}

/* -------------------------- Core commands -------------------------- */

async function cmdInit() {
  ensureDir(APP_DIR);
  ensureDir(LOG_DIR);
  if (!fs.existsSync(PROJECT_PATH)) writeJson(PROJECT_PATH, defaultProjectTemplate());
  if (!fs.existsSync(GOALS_PATH)) writeJson(GOALS_PATH, []);
  audit({ kind: "init" });
  console.log(`Initialized:\n  ${PROJECT_PATH}\n  ${GOALS_PATH}`);
}

async function cmdList() {
  const { goals } = loadState();
  audit({ kind: "list", count: goals.length });
  if (!goals.length) return void console.log("(no goals yet)");
  for (const g of goals) {
    console.log(`- ${g.id} (priority: ${g.priority})`);
    console.log(`  objective: ${g.objective}`);
    if (g.dependencies?.length) console.log(`  dependencies: ${g.dependencies.join(", ")}`);
    if (g.constraints?.length) console.log(`  constraints: ${g.constraints.join("; ")}`);
    if (g.criteria?.success?.length) console.log(`  success: ${g.criteria.success.length} item(s)`);
    if (g.criteria?.acceptance?.length) console.log(`  acceptance: ${g.criteria.acceptance.length} item(s)`);
    if (g.criteria?.validation) console.log(`  validation: ${g.criteria.validation}`);
  }
}

async function cmdRemove(id) {
  const { project, goals } = loadState();
  const next = goals.filter((g) => g.id !== id);
  if (next.length === goals.length) return void console.log(`No goal found with id "${id}".`);
  saveState(project, next);
  audit({ kind: "remove_goal", id });
  console.log(`Removed "${id}".`);
}

function setByPathSimple(obj, dottedPath, valueRaw) {
  const parts = dottedPath.split(".").filter(Boolean);
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (cur[k] == null || typeof cur[k] !== "object") cur[k] = {};
    cur = cur[k];
  }
  const last = parts[parts.length - 1];
  let v;
  try { v = JSON.parse(valueRaw); } catch { v = valueRaw; }
  cur[last] = v;
}

async function cmdSet(pth, value) {
  const { project, goals } = loadState();
  setByPathSimple(project, pth, value);
  saveState(project, goals);
  audit({ kind: "set", path: pth });
  console.log(`Set ${pth} in project.json`);
}

function shallowMerge(a, b) {
  return { ...(a || {}), ...(b || {}) };
}

async function cmdImport(source, flags, logCtx) {
  const obj = await loadFromSource(source);
  const { project, goals } = coerceConfigToProjectGoals(obj);
  const normalizedGoals = goals.map(normalizeGoal);

  ensureDir(APP_DIR);
  saveState(project, normalizedGoals);
  audit({ kind: "import" });

  if (flags["ai-edit"]) await cmdAiEdit(flags, logCtx);

  console.log(`Imported:\n  project -> ${PROJECT_PATH}\n  goals   -> ${GOALS_PATH}`);
}

async function cmdMeta(source, mode, flags, logCtx) {
  const { project, goals } = loadState();
  const obj = await loadFromSource(source);
  const meta = obj.metadata && typeof obj.metadata === "object" ? obj.metadata : obj;
  if (meta == null || typeof meta !== "object") throw new Error("Metadata source must be an object (or {metadata:{...}}).");

  if (mode === "replace") project.metadata = meta;
  else project.metadata = shallowMerge(project.metadata, meta);

  saveState(project, goals);
  audit({ kind: "meta_update", mode });

  if (flags["ai-edit"]) await cmdAiEdit(flags, logCtx);

  console.log(`Updated metadata (${mode}).`);
}

async function cmdGoals(source, mode, flags, logCtx) {
  const { project } = loadState();
  const obj = await loadFromSource(source);
  const arr = Array.isArray(obj) ? obj : obj.goals;
  if (!Array.isArray(arr)) throw new Error('Goals source must be an array or object with "goals": []');

  const normalized = arr.map(normalizeGoal);
  writeJson(GOALS_PATH, normalized);
  writeJson(PROJECT_PATH, project);
  audit({ kind: "goals_update", mode, count: normalized.length });

  if (flags["ai-edit"]) await cmdAiEdit(flags, logCtx);

  console.log(`Updated goals (${mode}).`);
}

function parseContextPairs(pairs) {
  const ctx = {};
  for (const line of pairs || []) {
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    if (!k) continue;
    const asNum = Number(v);
    ctx[k] = (v !== "" && Number.isFinite(asNum) && String(asNum) === v) ? asNum : v;
  }
  return ctx;
}

function buildGoalFromManualFlags(flags) {
  if (flags.json) return normalizeGoal(JSON.parse(flags.json));

  if (!flags.id || !flags.objective || flags.priority == null) {
    throw new Error("Manual add requires --id, --objective, --priority (or run add without flags for interactive).");
  }

  const priority = Number(flags.priority);
  const dependencies = flags.dep?.length ? flags.dep : undefined;
  const constraints = flags.constraint?.length ? flags.constraint : undefined;

  const success = flags.success?.length ? flags.success : [];
  const acceptance = flags.acceptance?.length ? flags.acceptance : undefined;
  const validation = flags.validation;
  const context = flags.context?.length ? parseContextPairs(flags.context) : undefined;

  return normalizeGoal({
    id: flags.id,
    objective: flags.objective,
    priority,
    ...(dependencies ? { dependencies } : {}),
    criteria: {
      success,
      ...(acceptance ? { acceptance } : {}),
      ...(validation ? { validation } : {}),
    },
    ...(constraints ? { constraints } : {}),
    ...(context ? { context } : {}),
  });
}

async function cmdAdd(flags, logCtx) {
  const { project, goals } = loadState();

  const hasManual =
    !!flags.json || !!flags.id || !!flags.objective || flags.priority != null || (flags.success && flags.success.length > 0);

  if (hasManual) {
    const goal = buildGoalFromManualFlags(flags);
    if (goals.some((g) => g.id === goal.id)) throw new Error(`Goal with id "${goal.id}" already exists.`);
    goals.push(goal);
    saveState(project, goals);
    audit({ kind: "add_goal", id: goal.id, mode: "manual" });

    if (flags["ai-edit"]) await cmdAiEdit(flags, logCtx);

    console.log(`Saved goal "${goal.id}".`);
    return;
  }

  const rl = rlPrompt();
  try {
    console.log("Create a new goal object.");
    const id = (await question(rl, "id (e.g. setup-database): ")).trim();
    const objective = (await question(rl, "objective: ")).trim();
    const priority = Number((await question(rl, "priority (number): ")).trim());

    const dependencies = (await promptYesNo(rl, "Add dependencies?")) ? await promptList(rl, "dependencies") : undefined;
    console.log("\ncriteria.success");
    const success = await promptList(rl, "success criteria");
    const acceptance = (await promptYesNo(rl, "Add criteria.acceptance?")) ? await promptList(rl, "acceptance criteria") : undefined;
    const validation = (await promptYesNo(rl, "Set criteria.validation?")) ? (await question(rl, "criteria.validation: ")).trim() : undefined;
    const constraints = (await promptYesNo(rl, "Add constraints?")) ? await promptList(rl, "constraints") : undefined;

    const goal = normalizeGoal({
      id,
      objective,
      priority,
      ...(dependencies ? { dependencies } : {}),
      criteria: {
        success,
        ...(acceptance ? { acceptance } : {}),
        ...(validation ? { validation } : {}),
      },
      ...(constraints ? { constraints } : {}),
    });

    if (goals.some((g) => g.id === goal.id)) throw new Error(`Goal with id "${goal.id}" already exists.`);
    goals.push(goal);
    saveState(project, goals);
    audit({ kind: "add_goal", id: goal.id, mode: "interactive" });

    if (flags["ai-edit"]) await cmdAiEdit(flags, logCtx);

    console.log(`Saved goal "${goal.id}".`);
  } finally {
    rl.close();
  }
}

async function cmdEdit(id) {
  const { project, goals } = loadState();
  const idx = goals.findIndex((g) => g.id === id);
  if (idx === -1) throw new Error(`No goal found with id "${id}".`);

  const original = goals[idx];
  const rl = rlPrompt();
  try {
    console.log(`Editing goal "${id}". Press enter to keep current value.\n`);
    const objective = (await question(rl, `objective [${original.objective}]: `)).trim() || original.objective;
    const prIn = (await question(rl, `priority [${original.priority}]: `)).trim();
    const priority = prIn ? Number(prIn) : original.priority;

    const editSuccess = await promptYesNo(rl, "Edit criteria.success?", false);
    const success = editSuccess ? await promptList(rl, "success criteria") : original.criteria?.success;

    const updated = normalizeGoal({
      ...original,
      objective,
      priority,
      criteria: { ...(success ? { success } : {}) },
    });

    goals[idx] = updated;
    saveState(project, goals);
    audit({ kind: "edit_goal", id });
    console.log(`Updated "${id}".`);
  } finally {
    rl.close();
  }
}

/* -------------------------- Export -------------------------- */

async function cmdExport(flags, logCtx) {
  if (flags["ai-edit"]) await cmdAiEdit(flags, logCtx);

  const { project, goals } = loadState();
  const outObj = { ...project, goals: goals.map(normalizeGoal) };

  if (flags.stdout) {
    audit({ kind: "export", mode: "stdout" });
    process.stdout.write(JSON.stringify(outObj, null, 2) + "\n");
    return;
  }

  const outPath = path.resolve(process.cwd(), flags.out || "export.json");
  writeJson(outPath, outObj);
  audit({ kind: "export", mode: "file", outPath });

  const onSuccess = normalizeOnSuccess(flags);
  if (onSuccess.length) {
    await runOnSuccess(onSuccess, { export_path: outPath, project_path: PROJECT_PATH, goals_path: GOALS_PATH }, logCtx.debugPath);
  }

  console.log(`Wrote ${outPath}`);
}

/* -------------------------- Arg parsing -------------------------- */

function parseArgs(argv) {
  const args = [...argv];
  const cmd = args.shift();

  const flags = {};
  const rest = [];

  while (args.length) {
    const a = args[0];
    if (a && a.startsWith("--")) {
      const key = a.slice(2);
      args.shift();
      const next = args[0];
      if (!next || next.startsWith("--")) {
        flags[key] = true;
        continue;
      }
      const val = args.shift();
      if (flags[key] == null) flags[key] = val;
      else if (Array.isArray(flags[key])) flags[key].push(val);
      else flags[key] = [flags[key], val];
      continue;
    }
    rest.push(args.shift());
  }

  // normalize repeatables
  for (const k of ["dep", "constraint", "success", "acceptance", "context", "on-success", "ai-edit-include", "ai-edit-exclude"]) {
    if (flags[k] && !Array.isArray(flags[k])) flags[k] = [flags[k]];
  }

  return { cmd, rest, flags };
}

/* -------------------------- Main -------------------------- */

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) usage(1);

  const { cmd, rest, flags } = parseArgs(argv);

  const logCtx = initLogs(!!flags.debug);
  audit({ kind: "command_start", cmd, argv });

  try {
    switch (cmd) {
      case "init":
        await cmdInit();
        break;
      case "add":
        await cmdAdd(flags, logCtx);
        break;
      case "list":
        await cmdList();
        break;
      case "remove":
        if (!rest[0]) usage(1);
        await cmdRemove(rest[0]);
        break;
      case "edit":
        if (!rest[0]) usage(1);
        await cmdEdit(rest[0]);
        break;
      case "set":
        if (!rest[0] || rest.length < 2) usage(1);
        await cmdSet(rest[0], rest.slice(1).join(" "));
        break;
      case "export":
        await cmdExport(flags, logCtx);
        break;

      case "import": {
        const source = { json: flags.json, file: flags.file, url: flags.url };
        await cmdImport(source, flags, logCtx);
        const onSuccess = normalizeOnSuccess(flags);
        if (onSuccess.length) await runOnSuccess(onSuccess, { export_path: "", project_path: PROJECT_PATH, goals_path: GOALS_PATH }, logCtx.debugPath);
        break;
      }

      case "meta": {
        const mode = flags.replace ? "replace" : "merge";
        const source = { json: flags.json, file: flags.file, url: flags.url };
        await cmdMeta(source, mode, flags, logCtx);
        const onSuccess = normalizeOnSuccess(flags);
        if (onSuccess.length) await runOnSuccess(onSuccess, { export_path: "", project_path: PROJECT_PATH, goals_path: GOALS_PATH }, logCtx.debugPath);
        break;
      }

      case "goals": {
        const mode = "replace";
        const source = { json: flags.json, file: flags.file, url: flags.url };
        await cmdGoals(source, mode, flags, logCtx);
        const onSuccess = normalizeOnSuccess(flags);
        if (onSuccess.length) await runOnSuccess(onSuccess, { export_path: "", project_path: PROJECT_PATH, goals_path: GOALS_PATH }, logCtx.debugPath);
        break;
      }

      case "ai-edit": {
        await cmdAiEdit(flags, logCtx);
        const onSuccess = normalizeOnSuccess(flags);
        if (onSuccess.length) await runOnSuccess(onSuccess, { export_path: "", project_path: PROJECT_PATH, goals_path: GOALS_PATH }, logCtx.debugPath);
        break;
      }

      case "help":
      case "--help":
      case "-h":
        usage(0);
        break;

      default:
        console.error(`Unknown command: ${cmd}\n`);
        usage(1);
    }

    audit({ kind: "command_complete", cmd });
  } catch (err) {
    audit({ kind: "command_error", cmd, message: err?.message || String(err) });
    console.error("Error:", err?.message || String(err));
    process.exit(1);
  }
}

await main();
