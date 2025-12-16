// src/proxy.ts
import type { AppConfig, Rule } from "./config";
import { MemoryCache, CachedEntry } from "./cache";
import { buildKey } from "./key";
import { computePolicy, filterHeaders, joinUpstream, rfc3339 } from "./policy";
import { readInvalidation, respond304FromCache, maybeServeStale } from "./invalidation";

function findRule(cfg: AppConfig, req: Request, url: URL): {
  rule?: Rule;
  keyTemplate: string;
  statusHeaders: AppConfig["defaults"]["status_headers"];
  upstreamBase?: string;
} {
  const host = req.headers.get("host") ?? "";
  for (const r of cfg.rules) {
    const re = new RegExp(r.match.path_regex);
    if (!re.test(url.pathname)) continue;
    if (r.match.host && r.match.host !== host) continue;
    const methods = r.match.methods ?? ["GET", "HEAD"];
    if (!methods.some((m) => m.toUpperCase() === req.method.toUpperCase())) continue;

    return {
      rule: r,
      keyTemplate: r.key_template,
      statusHeaders: r.status_headers ?? cfg.defaults.status_headers,
      upstreamBase: r.upstream_base,
    };
  }
  return {
    keyTemplate: "v1:{method}:{host}:{path}?{query}",
    statusHeaders: cfg.defaults.status_headers,
  };
}

export function createHandler(getConfig: () => AppConfig, cache: MemoryCache) {
  return async function handler(req: Request): Promise<Response> {
    const cfg = getConfig();
    const url = new URL(req.url);

    // Admin invalidation endpoint
    if (url.pathname === "/admin/invalidate" && req.method.toUpperCase() === "POST") {
      const params = url.searchParams;
      const statusHeaders = cfg.defaults.status_headers;
      const h = new Headers({ "content-type": "application/json; charset=utf-8" });

      if (params.has("all")) {
        const removed = cache.clearAll();
        h.set(statusHeaders.cache, "INVALIDATED-ALL");
        return new Response(JSON.stringify({ removed }), { status: 200, headers: h });
      }
      if (params.has("rule")) {
        const ruleName = params.get("rule")!;
        const removed = cache.deleteByRule(ruleName);
        h.set(statusHeaders.cache, "INVALIDATED-RULE");
        return new Response(JSON.stringify({ rule: ruleName, removed }), { status: 200, headers: h });
      }
      if (params.has("key")) {
        const key = params.get("key")!;
        cache.delete(key);
        h.set(statusHeaders.cache, "INVALIDATED");
        h.set(statusHeaders.key, key);
        return new Response(JSON.stringify({ key, removed: 1 }), { status: 200, headers: h });
      }
      return new Response(JSON.stringify({ error: "specify ?all=1 or ?rule=<name> or ?key=<key>" }), {
        status: 400,
        headers: h,
      });
    }

    // Normal proxy flow
    const { rule, keyTemplate, statusHeaders } = findRule(cfg, req, url);
    const effectiveMethods = (rule?.match.methods ?? cfg.defaults.cache_methods).map((m) => m.toUpperCase());
    const cacheable = effectiveMethods.includes(req.method.toUpperCase());

    const inv = readInvalidation(req.headers, cfg.defaults.invalidation);
    const key = buildKey(req, url, keyTemplate);

    // Invalidate via header
    if (inv.invalidate) {
      const h = new Headers();
      if (inv.mode === "all") {
        cache.clearAll();
        h.set(statusHeaders.cache, "INVALIDATED-ALL");
        h.set(statusHeaders.key, "*");
        return new Response(null, { status: 204, headers: h });
      } else if (inv.mode === "rule" && inv.ruleName) {
        cache.deleteByRule(inv.ruleName);
        h.set(statusHeaders.cache, "INVALIDATED-RULE");
        h.set(statusHeaders.key, `rule:${inv.ruleName}`);
        return new Response(null, { status: 204, headers: h });
      } else {
        cache.delete(key);
        h.set(statusHeaders.cache, "INVALIDATED");
        h.set(statusHeaders.key, key);
        return new Response(null, { status: 204, headers: h });
      }
    }

    const cached = cache.get(key);
    const now = Date.now();
    if (cacheable && !inv.bypass && cached) {
      const fresh = cached.expiresAt !== undefined && cached.expiresAt > now;
      if (fresh) {
        const r304 = respond304FromCache(req, cached, statusHeaders, key);
        if (r304) return r304;

        const h = new Headers(cached.headers);
        h.set(statusHeaders.cache, "HIT");
        h.set(statusHeaders.key, key);
        const exp = rfc3339(cached.expiresAt);
        if (exp) h.set(statusHeaders.expires, exp);
        return new Response(
          cached.body, 
          { 
            status: cached.status, 
            headers: h 
          }
        );
      }

      // STALE → revalidate
      const base = rule?.upstream_base ?? cfg.upstream_base;
      const upstreamUrl = joinUpstream(base, url);
      const fwdHeaders = filterHeaders(req.headers);
      if (cached.etag) fwdHeaders.set("If-None-Match", cached.etag);
      if (cached.lastModified) fwdHeaders.set("If-Modified-Since", cached.lastModified);

      const bodyNeeded = !["GET", "HEAD"].includes(req.method.toUpperCase());
      const reqInit: RequestInit = {
        method: req.method,
        headers: fwdHeaders,
        body: bodyNeeded ? await req.arrayBuffer() : undefined,
        redirect: "manual",
      };

      let upstream: Response;
      try {
        upstream = await fetch(upstreamUrl, reqInit);
      } catch {
        const s = maybeServeStale(cfg.defaults, cached, statusHeaders, key, "STALE-IF-ERROR");
        if (s) return s;
        return new Response("Bad Gateway", { status: 502 });
      }

      if (upstream.status === 304) {
        const upHdrs = filterHeaders(upstream.headers);
        const { expiresAt } = computePolicy({ defaults: cfg.defaults, rule, upstream: upHdrs, status: 200 });

        const merged = new Headers(cached.headers);
        for (const name of ["Date", "Expires", "Cache-Control", "ETag", "Last-Modified"]) {
          const v = upHdrs.get(name);
          if (v !== null) merged.set(name, v);
        }

        cached.headers = merged;
        cached.expiresAt = expiresAt;
        cached.etag = upHdrs.get("ETag") ?? cached.etag;
        cached.lastModified = upHdrs.get("Last-Modified") ?? cached.lastModified;
        cached.cacheControl = upHdrs.get("Cache-Control") ?? cached.cacheControl;
        cache.set(key, cached);

        const h = new Headers(merged);
        h.set(statusHeaders.cache, "REVALIDATED");
        h.set(statusHeaders.key, key);
        const exp = rfc3339(expiresAt);
        if (exp) h.set(statusHeaders.expires, exp);
        return new Response(cached.body, { status: cached.status, headers: h });
      }

      if (upstream.status >= 500) {
        const s = maybeServeStale(cfg.defaults, cached, statusHeaders, key, "STALE-IF-ERROR");
        if (s) return s;
      }

      const upHdrs = filterHeaders(upstream.headers);
      const buf = new Uint8Array(await upstream.arrayBuffer());
      const { shouldCache, expiresAt } = computePolicy({ defaults: cfg.defaults, rule, upstream: upHdrs, status: upstream.status });

      const respHdrs = new Headers(upHdrs);
      if (cacheable && shouldCache) {
        const newEntry: CachedEntry = {
          status: upstream.status,
          headers: upHdrs,
          body: buf,
          expiresAt,
          etag: upHdrs.get("ETag") ?? undefined,
          lastModified: upHdrs.get("Last-Modified") ?? undefined,
          cacheControl: upHdrs.get("Cache-Control") ?? undefined,
          ruleName: rule?.name,
        };
        cache.set(key, newEntry);
        respHdrs.set(statusHeaders.cache, "UPDATED");
        respHdrs.set(statusHeaders.key, key);
        const exp = rfc3339(expiresAt);
        if (exp) respHdrs.set(statusHeaders.expires, exp);
      } else {
        respHdrs.set(statusHeaders.cache, "PASS");
        respHdrs.set(statusHeaders.key, key);
      }
      return new Response(buf, { status: upstream.status, headers: respHdrs });
    }

    // MISS or BYPASS → upstream
    const base = rule?.upstream_base ?? cfg.upstream_base;
    const upstreamUrl = joinUpstream(base, url);
    const fwdHeaders = filterHeaders(req.headers);

    for (const hn of ["If-None-Match", "If-Modified-Since"]) {
      const v = req.headers.get(hn);
      if (v) fwdHeaders.set(hn, v);
    }

    const bodyNeeded = !["GET", "HEAD"].includes(req.method.toUpperCase());
    const reqInit: RequestInit = {
      method: req.method,
      headers: fwdHeaders,
      body: bodyNeeded ? await req.arrayBuffer() : undefined,
      redirect: "manual",
    };

    let upstream: Response;
    try {
      upstream = await fetch(upstreamUrl, reqInit);
    } catch {
      if (cached) {
        const s = maybeServeStale(cfg.defaults, cached, statusHeaders, key, "STALE-IF-ERROR");
        if (s) return s;
      }
      return new Response("Bad Gateway", { status: 502 });
    }

    const upHdrs = filterHeaders(upstream.headers);
    const buf = new Uint8Array(await upstream.arrayBuffer());
    const { shouldCache, expiresAt } = computePolicy({ defaults: cfg.defaults, rule, upstream: upHdrs, status: upstream.status });

    const respHdrs = new Headers(upHdrs);
    if (cacheable && shouldCache && !inv.bypass) {
      const entry: CachedEntry = {
        status: upstream.status,
        headers: upHdrs,
        body: buf,
        expiresAt,
        etag: upHdrs.get("ETag") ?? undefined,
        lastModified: upHdrs.get("Last-Modified") ?? undefined,
        cacheControl: upHdrs.get("Cache-Control") ?? undefined,
        ruleName: rule?.name,
      };
      cache.set(key, entry);
      respHdrs.set(statusHeaders.cache, "MISS");
      respHdrs.set(statusHeaders.key, key);
      const exp = rfc3339(expiresAt);
      if (exp) respHdrs.set(statusHeaders.expires, exp);
    } else {
      respHdrs.set(statusHeaders.cache, inv.bypass ? "BYPASS" : "PASS");
      respHdrs.set(statusHeaders.key, key);
    }

    return new Response(buf, { status: upstream.status, headers: respHdrs });
  };
}
