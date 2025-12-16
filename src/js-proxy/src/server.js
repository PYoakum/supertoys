import { serve } from "bun";
import * as fs from "node:fs";
import * as path from "node:path";
import YAML from "yaml";

/** ---------------- Defaults ---------------- */

const defaultNormalization = {
  enabled: true,
  lowercase_host: true,
  strip_default_port: true,
  collapse_slashes: true,
  remove_dot_segments: true,
  decode_unreserved: true,
  strip_fragment: true,
  sort_query: true,
  trailing_slash: "preserve", // "add" | "remove" | "preserve"
  drop_query_params: [],
  keep_only_query_params: [],
  max_path_length: 4096,
};

function withDefaults(cfg) {
  cfg.normalization = { ...defaultNormalization, ...(cfg.normalization ?? {}) };
  for (const r of cfg.routes) {
    // note: field is "match_" in YAML to avoid JS keyword conflicts
    r.match_ ??= { kind: "prefix", path: "/", hosts: [] };
    r.match_.hosts ??= [];
    r.methods ??= [];
    r.add_request_headers ??= {};
    r.add_response_headers ??= {};
    r.conditions ??= [];
  }
  return cfg;
}

/** ---------------- Matching & templating ---------------- */

function hostsMatch(patterns, host) {
  const list = patterns && patterns.length ? patterns : undefined;
  if (!list) return true;
  for (const p of list) {
    const trimmed = p.trim();
    if (trimmed === "*") return true;
    if (trimmed.startsWith("*.")) {
      const suffix = trimmed.slice(2);
      if (host.toLowerCase().endsWith("." + suffix.toLowerCase())) return true;
    } else if (trimmed.toLowerCase() === host.toLowerCase()) {
      return true;
    }
  }
  return false;
}

function compilePattern(pat) {
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

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchRoute(routes, host, pathname, method) {
  for (const r of routes) {
    const m = r.match_;
    if (!hostsMatch(m.hosts, host)) continue;

    const captures = {};
    let pathOK = false;

    switch (m.kind) {
      case "exact":
        pathOK = pathname === m.path;
        break;
      case "prefix":
        pathOK = pathname.startsWith(m.path);
        break;
      case "pattern": {
        if (!m.path) break;
        const re = compilePattern(m.path);
        const match = pathname.match(re);
        if (match && match.groups) {
          Object.assign(captures, match.groups);
          pathOK = true;
        }
        break;
      }
      default:
        pathOK = false;
    }

    if (!pathOK) continue;

    if (r.methods && r.methods.length) {
      const allowed = r.methods.some((x) => x.toUpperCase() === method.toUpperCase());
      if (!allowed) return "MethodNotAllowed";
    }

    return { route: r, captures };
  }

  return "NoMatch";
}

function renderTemplate(input, caps) {
  return (input ?? "").replace(/\{([a-zA-Z0-9_\-]+)\}/g, (_m, key) => caps[key] ?? "");
}

/** ---------------- URL normalization ---------------- */

function normalizeParts(n, rawHost, rawPath, rawQuery) {
  // host
  let host = (rawHost ?? "").trim();
  if (n.lowercase_host) host = host.toLowerCase();
  if (host.endsWith(".")) host = host.slice(0, -1);
  if (n.strip_default_port) {
    const idx = host.lastIndexOf(":");
    if (idx > -1) {
      const p = host.slice(idx + 1);
      if (p === "80" || p === "443") host = host.slice(0, idx);
    }
  }

  // path
  let p = rawPath || "/";
  if (n.decode_unreserved) p = decodeUnreservedOnly(p);
  if (n.collapse_slashes) p = collapseSlashes(p);
  if (n.remove_dot_segments) p = removeDotSegments(p);
  if (n.trailing_slash === "add") {
    if (!p.endsWith("/")) p += "/";
  } else if (n.trailing_slash === "remove") {
    if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  }
  if (!p.startsWith("/")) p = "/" + p;

  // query
  let q = "";
  if (rawQuery) {
    const params = [...new URLSearchParams(rawQuery)];
    let pairs = params.map(([k, v]) => [k, v]);

    if (n.keep_only_query_params && n.keep_only_query_params.length) {
      const allow = n.keep_only_query_params.map((s) => s.toLowerCase());
      pairs = pairs.filter(([k]) => allow.includes(k.toLowerCase()));
    } else if (n.drop_query_params && n.drop_query_params.length) {
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

// Decode percent-encodings, but keep '/' intact; re-encode non-unreserved chars
function decodeUnreservedOnly(input) {
  try {
    const decoded = decodeURIComponent(input.replace(/%2F/gi, "%2F"));
    let out = "";
    for (const ch of decoded) {
      const isUnreserved =
        (ch >= "A" && ch <= "Z") ||
        (ch >= "a" && ch <= "z") ||
        (ch >= "0" && ch <= "9") ||
        ch === "-" ||
        ch === "." ||
        ch === "_" ||
        ch === "~" ||
        ch === "/";
      if (isUnreserved) {
        out += ch;
      } else {
        const enc = new TextEncoder().encode(ch);
        for (const b of enc) out += "%" + b.toString(16).toUpperCase().padStart(2, "0");
      }
    }
    return out;
  } catch {
    return input;
  }
}

function collapseSlashes(p) {
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

function removeDotSegments(p) {
  const segs = p.split("/");
  const out = [];
  for (const s of segs) {
    if (s === "" || s === ".") continue;
    if (s === "..") out.pop();
    else out.push(s);
  }
  const joined = "/" + out.join("/");
  return p.endsWith("/") && !joined.endsWith("/") ? joined + "/" : joined;
}

function hasControlChars(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

/** ---------------- Hop-by-hop ---------------- */

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

function copyClientHeaders(req) {
  const out = new Headers();
  req.headers.forEach((v, k) => {
    if (!HOP_BY_HOP.has(k.toLowerCase()) && k.toLowerCase() !== "host") {
      out.set(k, v);
    }
  });
  return out;
}

function applyTemplatedHeaders(h, extra, caps) {
  for (const [k, v] of Object.entries(extra ?? {})) {
    h.set(k, renderTemplate(v, caps));
  }
}

/** ---------------- Conditions ---------------- */

function statusMatchesAny(status, patterns) {
  return patterns.some((p) => statusMatches(status, p));
}

function statusMatches(status, pattern) {
  const s = status;
  const p = String(pattern).trim().toLowerCase();
  if (/^\d{3}$/.test(p)) return s === Number(p);
  if (/^\dxx$/.test(p)) return Math.floor(s / 100) === Number(p[0]);
  const bits = p.split("-");
  if (bits.length === 2) {
    const a = parseStatusEdge(bits[0]);
    const b = parseStatusEdge(bits[1]);
    if (a != null && b != null) return s >= a && s <= b;
  }
  return false;
}

function parseStatusEdge(x) {
  const t = String(x).trim().toLowerCase();
  if (/^\d{3}$/.test(t)) return Number(t);
  if (/^\dxx$/.test(t)) return Number(t[0]) * 100;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** ---------------- Static response ---------------- */

function buildStaticResponse(spec, caps) {
  const status = spec?.status ?? 404;
  const bodyStr = renderTemplate(spec?.body ?? "", caps);
  const headers = new Headers();
  for (const [k, v] of Object.entries(spec?.headers ?? {})) {
    headers.set(k, renderTemplate(v, caps));
  }
  return new Response(bodyStr, { status, headers });
}

/** ---------------- Server ---------------- */

function parseBind(bind) {
  const [hostPart, portPart] = String(bind).split(":");
  const hostname = hostPart || "0.0.0.0";
  const port = Number(portPart ?? "8080");
  if (!Number.isFinite(port)) throw new Error(`Invalid port in bind: ${bind}`);
  return { hostname, port };
}

async function main() {
  const cfgPath = Bun.argv[2] ?? "./config.yaml";
  const txt = fs.readFileSync(path.resolve(cfgPath), "utf8");
  const rawCfg = YAML.parse(txt);
  const cfg = withDefaults(rawCfg);
  const norm = { ...defaultNormalization, ...(cfg.normalization ?? {}) };
  const { hostname, port } = parseBind(cfg.server.bind);

  const server = serve({
    hostname,
    port,
    fetch: async (req) => {
      try {
        const url = new URL(req.url);

        // Normalize inputs
        const rawHost = req.headers.get("host") ?? url.host;
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

        // Route match
        const matched = matchRoute(cfg.routes, host, normPath, req.method);
        if (matched === "MethodNotAllowed") {
          return new Response("method not allowed", { status: 405 });
        }
        if (matched === "NoMatch") {
          if (cfg.not_found) {
            const caps = { host, path: normPath, query: normQuery };
            return buildStaticResponse(cfg.not_found, caps);
          }
          return new Response("not found", { status: 404 });
        }

        const { route, captures } = matched;
        // Built-ins for templating
        captures.host = host;
        captures.path = normPath;
        captures.query = normQuery;

        // Static backend
        if (route.backend?.type === "static") {
          const resp = buildStaticResponse(
            {
              status: route.backend.status,
              body: route.backend.body,
              headers: route.backend.headers,
            },
            captures
          );
          // Plus route-level response headers
          const h = new Headers(resp.headers);
          applyTemplatedHeaders(h, route.add_response_headers, captures);
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
        applyTemplatedHeaders(headers, route.add_request_headers, captures);

        const hasBody =
          !["GET", "HEAD", "OPTIONS", "TRACE"].includes(req.method.toUpperCase());
        const body = hasBody ? await req.arrayBuffer() : undefined;

        const firstRes = await fetch(upstreamUrl, {
          method: req.method,
          headers,
          body: body ? new Uint8Array(body) : undefined,
        });

        // Conditions
        let finalRes = null;
        const conds = route.conditions ?? [];
        const st = firstRes.status;
        const matchedCond = conds.find((c) =>
          statusMatchesAny(st, Array.isArray(c.when_status) ? c.when_status : [c.when_status])
        );

        if (matchedCond) {
          const act = matchedCond.action;
          if (act.type === "fallback") {
            const fb = new URL(act.origin);
            fb.pathname = upstreamPath;
            fb.search = normQuery ? "?" + normQuery : "";
            // conservative: no body replay
            const fbRes = await fetch(fb, { method: req.method, headers });
            finalRes = fbRes;
          } else if (act.type === "override") {
            const h = new Headers();
            applyTemplatedHeaders(h, act.headers ?? {}, captures);
            const bodyStr = renderTemplate(act.body ?? "", captures);
            finalRes = new Response(bodyStr, { status: act.status, headers: h });
          } else if (act.type === "addHeaders") {
            const h = new Headers(firstRes.headers);
            applyTemplatedHeaders(h, act.headers ?? {}, captures);
            finalRes = new Response(await firstRes.arrayBuffer(), {
              status: firstRes.status,
              headers: h,
            });
          }
        }

        if (!finalRes) finalRes = firstRes;

        // Always add configured response headers (templated)
        const rh = new Headers(finalRes.headers);
        applyTemplatedHeaders(rh, route.add_response_headers, captures);
        // Strip hop-by-hop on response
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
