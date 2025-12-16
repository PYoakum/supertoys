/*

import createFileApiRouter from './api-router.ts'

const fetchHandler = await createFileApiRouter({
  dir:              "src/server/api/",       
  prefix:           "/api",                         
  importStrategy:   "mtimeBust"
});

*/
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

type RouteHandler = (req: Request, ctx: {
  params: Record<string, string>;
  query: URLSearchParams;
  url: URL;
  pathname: string;
}) => Promise<Response> | Response | unknown;

type RouteRecord = {
  pattern: RegExp;                 // compiled matcher
  paramNames: string[];            // ["id", ...]
  importer: () => Promise<{ default?: RouteHandler }>;
  filePath: string;                // for debugging
};

export type FileApiRouterOptions = {

  // directory to scan for endpoints (e.g. "./api")
  dir: string;
  
  // optional mount prefix, added in front of derived routes (e.g. "/api")
  prefix?: string;

   // cache strategy. "mtimeBust" reloads a module if file mtime changed. "once" imports once at boot.
  importStrategy?: "mtimeBust" | "once";

  // file extensions considered API modules.
  exts?: string[]; // default [".js", ".mjs"]
};

function toRoutePath(root: string, file: string): string {
  // Example mappings:
  //   api/users/index.js     -> /users
  //   api/users/[id].js      -> /users/:id
  //   api/[...rest].js       -> /* (catch-all) => /:rest(.*)
  //   api/health.js          -> /health
  const rel = path.relative(root, file).replace(/\\/g, "/");
  const noExt = rel.replace(/\.[^.]+$/, "");
  const segments = noExt.split("/").map(seg => {
    if (seg === "index") return "";
    // dynamic segments
    const m = seg.match(/^\[(\.{3})?(.+)\]$/);
    if (!m) return seg;
    const isCatchAll = !!m[1];
    const name = m[2];
    return isCatchAll ? `:${name}(.*)` : `:${name}`;
  });
  let p = "/" + segments.filter(Boolean).join("/");
  if (p === "") p = "/"; // root index
  return p;
}

function routeRegex(routePath: string): { pattern: RegExp; paramNames: string[] } {
  // Convert /users/:id(.*)? to regex and capture param names
  const paramNames: string[] = [];
  // Escape regex specials except ':' segments and custom (.*)
  const patternStr = routePath
    .split("/")
    .map(part => {
      if (!part) return "";
      if (part.startsWith(":")) {
        const nameMatch = part.match(/^:([^(/]+)(\((?:\.\*|\[\^.*\]|\?.*|[^)]*)\))?$/);
        const name = nameMatch?.[1] ?? part.slice(1);
        const custom = nameMatch?.[2];
        paramNames.push(name);
        return custom ? `(${custom.slice(1, -1)})` : "([^/]+)";
      }
      // escape
      return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return { pattern: new RegExp(`^${patternStr}/?$`), paramNames };
}

async function walkDir(dir: string, out: string[] = []): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      await walkDir(p, out);
    } else {
      out.push(p);
    }
  }
  return out;
}

export default async function createFileApiRouter(opts: FileApiRouterOptions) {
  const {
    dir,
    prefix = "",
    importStrategy = "mtimeBust",
    exts = [".js", ".mjs"],
  } = opts;

  const root = path.resolve(dir);
  const files = (await walkDir(root)).filter(f => exts.includes(path.extname(f)));

  const routes: RouteRecord[] = [];

  for (const file of files) {
    const localPath = toRoutePath(root, file);
    const fullPath = path.resolve(file);

    const withPrefix = (prefix + localPath) || "/";
    const { pattern, paramNames } = routeRegex(withPrefix);

    let lastMtime = 0;

    const importer = async () => {
      if (importStrategy === "mtimeBust") {
        const s = await stat(fullPath);
        const t = s.mtimeMs || Date.now();
        // Cache-bust via query string so Bun reloads the module if changed
        const href = pathToFileURL(fullPath).href + `?t=${t}`;
        lastMtime = t;
        return import(href) as Promise<{ default?: RouteHandler }>;
      } else {
        // Import once, then memoize
        const href = pathToFileURL(fullPath).href;
        const mod = await import(href);
        importerMemo = async () => mod;
        return mod as { default?: RouteHandler };
      }
    };

    // memoizer for "once" mode
    let importerMemo: null | (() => Promise<{ default?: RouteHandler }>) = null;

    routes.push({
      pattern,
      paramNames,
      importer: importerMemo ?? importer,
      filePath: fullPath,
    });
  }

  // Return your Bun fetch handler
  return async function fetchHandler(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // Find first matching route (static first, then dynamic by regex order)
    for (const r of routes) {
      const m = pathname.match(r.pattern);
      if (!m) continue;

      const params: Record<string, string> = {};
      r.paramNames.forEach((name, i) => {
        params[name] = decodeURIComponent(m[i + 1] ?? "");
      });

      // Import the handler on-demand
      let mod: { default?: RouteHandler };
      try {
        mod = await r.importer();
      } catch (e: any) {
        return new Response(
          JSON.stringify({ error: "Failed to load endpoint", file: r.filePath, message: String(e?.message ?? e) }),
          { status: 500, headers: { "content-type": "application/json" } }
        );
      }

      const handler = mod.default;
      if (typeof handler !== "function") {
        return new Response(
          JSON.stringify({ error: "Endpoint has no default export function", file: r.filePath }),
          { status: 500, headers: { "content-type": "application/json" } }
        );
      }

      // Call the default export. If it doesn't return a Response, JSONify it.
      try {
        const out = await handler(req, { params, query: url.searchParams, url, pathname });
        if (out instanceof Response) return out;
        if (out === undefined) return new Response(null, { status: 204 });
        return new Response(
          typeof out === "string" ? out : JSON.stringify(out),
          { status: 200, headers: { "content-type": typeof out === "string" ? "text/plain" : "application/json" } }
        );
      } catch (e: any) {
        const code = typeof e?.status === "number" ? e.status : 500;
        return new Response(
          JSON.stringify({ error: "Endpoint error", file: r.filePath, message: String(e?.message ?? e) }),
          { status: code, headers: { "content-type": "application/json" } }
        );
      }
    }

    // No match
    return new Response("Not Found", { status: 404 });
  };
}
