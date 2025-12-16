// src/invalidation.ts
import type { StatusHeaders, Defaults, Invalidation } from "./config";
import type { CachedEntry } from "./cache";
import { parseCacheControl, rfc3339 } from "./policy";

export function readInvalidation(headers: Headers, inv: Invalidation): {
  bypass: boolean;
  invalidate: boolean;
  mode: "key" | "rule" | "all";
  ruleName?: string;
} {
  const by = headers.get(inv.bypass_header) ?? "";
  const raw = headers.get(inv.invalidate_header) ?? "";
  const isTruthy = (v: string) =>
    inv.value_regex ? new RegExp(inv.value_regex).test(v) : /^(?:1|true|yes)$/i.test(v);

  if (/^all$/i.test(raw)) return { bypass: isTruthy(by), invalidate: true, mode: "all" };
  const m = raw.match(/^rule:(.+)$/i);
  if (m?.[1]) return { bypass: isTruthy(by), invalidate: true, mode: "rule", ruleName: m[1].trim() };
  return { bypass: isTruthy(by), invalidate: isTruthy(raw), mode: "key" };
}

export function respond304FromCache(
  req: Request,
  entry: CachedEntry,
  statusHdrs: StatusHeaders,
  key: string,
): Response | undefined {
  if (!["GET", "HEAD"].includes(req.method.toUpperCase())) return;
  const inm = req.headers.get("If-None-Match");
  const ims = req.headers.get("If-Modified-Since");

  let etagMatches = false;
  if (inm && entry.etag) {
    const tokens = inm.split(",").map((t) => t.trim());
    etagMatches = tokens.includes("*") || tokens.includes(entry.etag);
  }

  let lmOk = false;
  if (ims && entry.lastModified) {
    const imsTs = Date.parse(ims);
    const lmTs = Date.parse(entry.lastModified);
    if (!Number.isNaN(imsTs) && !Number.isNaN(lmTs)) lmOk = lmTs <= imsTs;
  }

  if (etagMatches || lmOk) {
    const h = new Headers();
    if (entry.etag) h.set("ETag", entry.etag);
    if (entry.lastModified) h.set("Last-Modified", entry.lastModified);
    if (entry.cacheControl) h.set("Cache-Control", entry.cacheControl);

    h.set(statusHdrs.cache, "HIT-304");
    h.set(statusHdrs.key, key);
    const exp = rfc3339(entry.expiresAt);
    if (exp) h.set(statusHdrs.expires, exp);
    return new Response(null, { status: 304, headers: h });
  }
  return undefined;
}

export function allowedStaleWindowSecs(defaults: Defaults, entry: CachedEntry): number {
  const cc = parseCacheControl(entry.cacheControl ?? "");
  if (cc.has("stale-if-error")) {
    const v = Number(cc.get("stale-if-error"));
    if (!Number.isNaN(v)) return v;
  }
  return defaults.stale_if_error_secs ?? 0;
}

export function maybeServeStale(
  defaults: Defaults,
  entry: CachedEntry,
  statusHdrs: StatusHeaders,
  key: string,
  label: string,
): Response | undefined {
  const now = Date.now();
  if (entry.expiresAt === undefined || entry.expiresAt > now) return;
  const stalenessSec = Math.floor((now - entry.expiresAt) / 1000);
  const allowed = allowedStaleWindowSecs(defaults, entry);
  if (stalenessSec <= allowed) {
    const h = new Headers(entry.headers);
    h.set("Warning", `110 - "Response is Stale"`);
    h.set(statusHdrs.cache, label);
    h.set(statusHdrs.key, key);
    const exp = rfc3339(entry.expiresAt);
    if (exp) h.set(statusHdrs.expires, exp);
    return new Response(entry.body, { status: entry.status, headers: h });
  }
  return undefined;
}
