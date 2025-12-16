import { serve } from "bun";
import * as fs from "node:fs";
import * as path from "node:path";
import  YAML  from "yaml";

// ---------------- Types ----------------

type HeaderMap = Record<string, string>;

type MatchKind = "exact" | "prefix" | "pattern";

interface ServerCfg {
  bind: string; // "0.0.0.0:8080"
}

interface Normalization {
  enabled: boolean;
  lowercase_host: boolean;
  strip_default_port: boolean;
  collapse_slashes: boolean;
  remove_dot_segments: boolean;
  decode_unreserved: boolean;
  strip_fragment: boolean;
  sort_query: boolean;
  trailing_slash: "add" | "remove" | "preserve";
  drop_query_params: string[];
  keep_only_query_params: string[];
  max_path_length: number;
}

interface MatchCfg {
  kind: MatchKind; // exact|prefix|pattern
  path: string;
  hosts?: string[]; // exact, "*.example.com", "*"
}

type Backend =
  | { type: "origin"; origin: string }
  | { type: "static"; status?: number; body?: string; headers?: HeaderMap };

interface Condition {
  when_status: string[] | string; // "404", "4xx", "5xx", "500-503"
  action:
    | { type: "fallback"; origin: string }
    | { type: "override"; status: number; body?: string; headers?: HeaderMap }
    | { type: "addHeaders"; headers: HeaderMap };
}

interface Route {
  name?: string;
  match_: MatchCfg;
  methods?: string[];
  backend: Backend;
  path_rewrite?: string;
  add_request_headers?: HeaderMap;
  add_response_headers?: HeaderMap;
  conditions?: Condition[];
}

interface StaticResponse {
  status?: number;
  body?: string;
  headers?: HeaderMap;
}

interface Config {
  server: ServerCfg;
  normalization?: Partial<Normalization>;
  not_found?: StaticResponse;
  routes: Route[];
}

// ---------------- Defaults ----------------

const defaultNormalization: Normalization = {
  enabled: true,
  lowercase_host: true,
  strip_default_port: true,
  collapse_slashes: true,
  remove_dot_segments: true,
  decode_unreserved: true,
  strip_fragment: true,
  sort_query: true,
  trailing_slash: "preserve",
  drop_query_params: [],
  keep_only_query_params: [],
  max_path_length: 4096,
};

function withDefaults(cfg: Config): Config {
  cfg.normalization = { ...defaultNormalization, ...(cfg.normalization ?? {}) };
  for (const r of cfg.routes) {
    r.match_.hosts ??= [];
    r.methods ??= [];
    r.add_request_headers ??= {};
    r.add_response_headers ??= {};
    r.conditions ??= [];
  }
  return cfg;
}

// ---------------- Utils: matching & templating ----------------

function hostsMatch(patterns: string[] | undefined, host: string): boolean {
  const list = patterns && patterns.length ? patterns : undefined;
  if (!list) return true;
  for (const p of list) {
    const trimmed = p.trim();
    if (trimmed === "*") return true;
    if (trimmed.startsWith("*.")) {
      const suffix = trimmed.slice(2);
      if (host.endsWith("." + suffix)) return true;
    } else if (trimmed.toLowerCase() === host.toLowerCase()) {
      return true;
    }
  }
  return false;
}

function compilePattern(pat: string): RegExp {
  // "/users/{id}/posts/{post_id}" -> ^/users/(?<id>[^/]+)/posts/(?<post_id>[^/]+)$
  let reSrc = "^";
  let i = 0;
  while (true) {
    const s = pat.indexOf("{", i);
    if (s === -1) {
      reSrc += escapeRegex(pat.slice(i));
      break;
    }
    reSrc += escapeRegex(pat.slice(i, s));
    const e = pat.indexOf("}", s + 1);
    if (e === -1) {
      reSrc += escapeRegex(pat.slice(s));
      break;
    }
    const name = pat.slice(s + 1, e);
    reSrc += `(?<${name}>[^/]+)`;
    i = e + 1;
  }
  reSrc += "$";
  return new RegExp(reSrc);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchRoute(
  routes: Route[],
  host: string,
  path: string,
  method: string
): { route: Route; captures: Record<string, string> } | "NoMatch" | "MethodNotAllowed" {
  for (const r of routes) {
    if (!hostsMatch(r.match_.hosts, host)) continue;

    const captures: Record<string, string> = {};
    let pathOK = false;

    switch (r.match_.kind) {
      case "exact":
        pathOK = path === r.match_.path;
        break;
      case "prefix":
        pathOK = path.startsWith(r.match_.path);
        break;
      case "pattern": {
        if (!r.match_.path) break;
        const re = compilePattern(r.match_.path);
        const m = path.match(re);
        if (m && m.groups) {
          Object.assign(captures, m.groups);
          pathOK = true;
        }
        break;
      }
      default:
        pathOK = false;
    }

    if (!pathOK) continue;

    if (r.methods && r.methods.length) {
      const allowed = r.methods.some((m) => m.toUpperCase() === method.toUpperCase());
      if (!allowed) return "MethodNotAllowed";
    }

    return { route: r, captures };
  }

  return "NoMatch";
}

function renderTemplate(input: string, caps: Record<string, string>): string {
  return input.replace(/\{([a-zA-Z0-9_\-]+)\}/g, (_m, key) => caps[key] ?? "");
}

// ---------------- URL normalization ----------------

function normalizeParts(
  n: Normalization,
  rawHost: string,
  rawPath: string,
  rawQuery: string
): { host: string; normPath: string; normQuery: string } {
  // Host
  let host = rawHost.trim();
  if (n.lowercase_host) host = host.toLowerCase();
  if (host.endsWith(".")) host = host.slice(0, -1);
  if (n.strip_default_port) {
    const idx = host.lastIndexOf(":");
    if (idx > -1) {
      const p = host.slice(idx + 1);
      if (p === "80" || p === "443") host = host.slice(0, idx);
    }
  }

  // Path
  let p = rawPath;
  if (n.decode_unreserved) p = decodeUnreservedOnly(p);
  if (n.collapse_slashes) p = collapseSlashes(p);
  if (n.remove_dot_segments) p = removeDotSegments(p);
  if (n.trailing_slash === "add") {
    if (!p.endsWith("/")) p += "/";
  } else if (n.trailing_slash === "remove") {
    if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  }
  if (!p.startsWith("/")) p = "/" + p;

  // Query
  let q = "";
  if (rawQuery) {
    const params = [...new URLSearchParams(rawQuery)];
    let pairs = params.map(([k, v]) => [k, v] as [string, string]);

    if (n.keep_only_query_params.length) {
      const allow = n.keep_only_query_params.map((s) => s.toLowerCase());
      pairs = pairs.filter(([k]) => allow.includes(k.toLowerCase()));
    } else if (n.drop_query_params.length) {
      const drop = n.drop_query_params.map((s) => s.toLowerCase());
      pairs = pairs.filter(([k]) => !drop.includes(k.toLowerCase()));
    }

    if (n.sort_query) {
      pairs.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
    }

    const sp = new URLSearchParams();
    for (const [k, v] of pairs) sp.append(k, v);
    q = sp.toString();
  }

  return { host, normPath: p, normQuery: q };
}

function decodeUnreservedOnly(input: string): string {
  // Decode percent-encodings, then re-encode anything that's not unreserved or '/'
  // Unreserved per RFC 3986: ALPHA / DIGIT / "-" / "." / "_" / "~"
  try {
    const decoded = decodeURIComponent(input.replace(/%2F/gi, "%2F")); // keep '/' safe
    let out = "";
    for (const ch of decoded) {
      const code = ch.charCodeAt(0);
      const isAscii = code <= 0x7f;
      const isUnreserved =
        (ch >= "A" && ch <= "Z") ||
        (ch >= "a" && ch <= "z") ||
        (ch >= "0" && ch <= "9") ||
        ch === "-" ||
        ch === "." ||
        ch === "_" ||
        ch === "~" ||
        ch === "/";
      if (isAscii && isUnreserved) {
        out += ch;
      } else {
        const enc = new TextEncoder().encode(ch);
        for (const b of enc) out += "%" + b.toString(16).toUpperCase().padStart(2, "0");
      }
    }
    return out;
  } catch {
    return input; // fallback
  }
}

function collapseSlashes(p: string): string {
  let out = "";
  let prevSlash = false;
  for (const ch of p) {
    if (ch === "/") {
      if (!prevSlash) out += "/";
      prevSlash = true;
    } else {
      out += ch;
      prevSlash = false;
    }
  }
  return out || "/";
}

function removeDotSegments(p: string): string {
  const segs = p.split("/");
  const out: string[] = [];
  for (const s of segs) {
    if (s === "" || s === ".") continue;
    if (s === "..") out.pop();
    else out.push(s);
  }
  const joined = "/" + out.join("/");
  return p.endsWith("/") && !joined.endsWith("/") ? joined + "/" : joined;
}

function hasControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

// ---------------- Hop-by-hop header stripping ----------------

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "upgrade",
  "transfer-encoding",
]);

function copyClientHeaders(req: Request): Headers {
  const out = new Headers();
  req.headers.forEach((v, k) => {
    if (!HOP_BY_HOP.has(k.toLowerCase()) && k.toLowerCase() !== "host") {
      out.set(k, v);
    }
  });
  return out;
}

function applyTemplatedHeaders(h: Headers, extra: HeaderMap, caps: Record<string, string>) {
  for (const [k, v] of Object.entries(extra)) {
    h.set(k, renderTemplate(v, caps));
  }
}

// ---------------- Conditions helpers ----------------

function statusMatchesAny(status: number, patterns: string[]): boolean {
  return patterns.some((p) => statusMatches(status, p));
}

function statusMatches(status: number, pattern: string): boolean {
  const s = status;
  const p = pattern.trim().toLowerCase();
  if (/^\d{3}$/.test(p)) return s === Number(p);
  if (/^\dxx$/.test(p)) return Math.floor(s / 100) === Number(p[0]);
  const range = p.split("-");
  if (range.length === 2) {
    const a = parseStatusEdge(range[0]);
    const b = parseStatusEdge(range[1]);
    if (a !== null && b !== null) return s >= a && s <= b;
  }
  return false;
}
function parseStatusEdge(x: string): number | null {
  const t = x.trim().toLowerCase();
  if (/^\d{3}$/.test(t)) return Number(t);
  if (/^\dxx$/.test(t)) return Number(t[0]) * 100;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// ---------------- Static response ----------------

function buildStaticResponse(spec: StaticResponse, caps: Record<string, string>): Response {
  const status = spec.status ?? 404;
  const bodyStr = renderTemplate(spec.body ?? "", caps);
  const headers = new Headers();
  for (const [k, v] of Object.entries(spec.headers ?? {})) {
    headers.set(k, renderTemplate(v, caps));
  }
  return new Response(bodyStr, { status, headers });
}

// ---------------- Server ----------------

function parseBind(bind: string): { hostname: string; port: number } {
  const [hostPart, portPart] = bind.split(":");
  const hostname = hostPart || "0.0.0.0";
  const port = Number(portPart ?? "8080");
  if (!Number.isFinite(port)) throw new Error(`Invalid port in bind: ${bind}`);
  return { hostname, port };
}

async function main() {
  const cfgPath = Bun.argv[2] ?? "./config.yaml";
  const txt = fs.readFileSync(path.resolve(cfgPath), "utf8");
  const rawCfg = YAML.parse(txt) as Config;
  const cfg = withDefaults(rawCfg);
  const norm = { ...defaultNormalization, ...(cfg.normalization ?? {}) } as Normalization;
  const { hostname, port } = parseBind(cfg.server.bind);

  const server = serve({
    hostname,
    port,
    fetch: async (req) => {
      try {
        const url = new URL(req.url);

        // Normalize
        const rawHost =
          req.headers.get("host") ??
          url.host; // prefer Host header; Bun sets url.host to "hostname:port"
        const rawPath = url.pathname || "/";
        const rawQuery = url.search.length ? url.search.slice(1) : "";

        const { host, normPath, normQuery } = norm.enabled
          ? normalizeParts(norm, rawHost, rawPath, rawQuery)
          : { host: rawHost, normPath: rawPath, normQuery: rawQuery };

        if (normPath.length > norm.max_path_length) {
          return new Response("path too long", { status: 400 });
        }
        if (hasControlChars(normPath) || hasControlChars(normQuery)) {
          return new Response("invalid url characters", { status: 400 });
        }

        // Match route
        const match = matchRoute(cfg.routes, host, normPath, req.method);
        if (match === "MethodNotAllowed") {
          return new Response("method not allowed", { status: 405 });
        }
        if (match === "NoMatch") {
          if (cfg.not_found) {
            const caps = { host, path: normPath, query: normQuery };
            return buildStaticResponse(cfg.not_found, caps);
          }
          return new Response("not found", { status: 404 });
        }

        const { route, captures } = match;
        // Built-in vars
        captures["host"] = host;
        captures["path"] = normPath;
        captures["query"] = normQuery;

        // Static backend
        if (route.backend.type === "static") {
          const resp = buildStaticResponse(
            {
              status: route.backend.status,
              body: route.backend.body,
              headers: route.backend.headers,
            },
            captures
          );
          // Add templated response headers (route level)
          const h = new Headers(resp.headers);
          applyTemplatedHeaders(h, route.add_response_headers ?? {}, captures);
          return new Response(await resp.text(), { status: resp.status, headers: h });
        }

        // Origin backend
        const origin = route.backend.origin;
        const upstreamPath = route.path_rewrite
          ? renderTemplate(route.path_rewrite, captures)
          : normPath;

        const upstreamUrl = new URL(origin);
        upstreamUrl.pathname = upstreamPath;
        upstreamUrl.search = normQuery ? "?" + normQuery : "";

        // Build upstream request
        const headers = copyClientHeaders(req);
        applyTemplatedHeaders(headers, route.add_request_headers ?? {}, captures);

        // Read body once (buffer). Bun allows cloning the request, but buffering is explicit.
        const hasBody =
          req.method !== "GET" &&
          req.method !== "HEAD" &&
          req.method !== "OPTIONS" &&
          req.method !== "TRACE";
        const body = hasBody ? await req.arrayBuffer() : undefined;

        const firstRes = await fetch(upstreamUrl, {
          method: req.method,
          headers,
          body: body ? new Uint8Array(body) : undefined,
          // Keep Bun defaults for agent/HTTP2. You can tune if needed.
        });

        // Apply conditions
        let finalRes: Response | null = null;
        const conds = route.conditions ?? [];
        const status = firstRes.status;

        const matchedCond = conds.find((c) =>
          statusMatchesAny(status, Array.isArray(c.when_status) ? c.when_status : [c.when_status])
        );

        if (matchedCond) {
          const act = matchedCond.action as Condition["action"];
          if (act.type === "fallback") {
            const fb = new URL(act.origin);
            fb.pathname = upstreamPath;
            fb.search = normQuery ? "?" + normQuery : "";
            // conservative: no body replay on fallback
            const fbRes = await fetch(fb, { method: req.method, headers });
            finalRes = fbRes;
          } else if (act.type === "override") {
            const h = new Headers();
            applyTemplatedHeaders(h, act.headers ?? {}, captures);
            const bodyStr = renderTemplate(act.body ?? "", captures);
            finalRes = new Response(bodyStr, { status: act.status, headers: h });
          } else if (act.type === "addHeaders") {
            const h = new Headers(firstRes.headers);
            applyTemplatedHeaders(h, act.headers, captures);
            finalRes = new Response(await firstRes.arrayBuffer(), {
              status: firstRes.status,
              headers: h,
            });
          }
        }

        if (!finalRes) {
          finalRes = firstRes;
        }

        // Always add configured response headers (templated)
        const rh = new Headers(finalRes.headers);
        applyTemplatedHeaders(rh, route.add_response_headers ?? {}, captures);

        // Strip hop-by-hop from response too
        for (const k of [...rh.keys()]) {
          if (HOP_BY_HOP.has(k.toLowerCase())) rh.delete(k);
        }

        return new Response(await finalRes.arrayBuffer(), {
          status: finalRes.status,
          headers: rh,
        });
      } catch (err) {
        console.error("proxy error:", err);
        return new Response("bad gateway", { status: 502 });
      }
    },
  });

  console.log(`listening on http://${server.hostname}:${server.port}`);
}

main();
