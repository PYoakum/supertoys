// src/policy.ts
import type { Defaults, Rule } from "./config";

export const HOP_BY_HOP = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailers", "transfer-encoding", "upgrade",
]);

export function filterHeaders(src: Headers): Headers {
  const out = new Headers();
  src.forEach((v, k) => {
    if (!HOP_BY_HOP.has(k.toLowerCase())) out.set(k, v);
  });
  return out;
}

export function rfc3339(ts?: number) {
  return ts ? new Date(ts).toISOString() : undefined;
}

export function parseCacheControl(cc?: string | null) {
  const m = new Map<string, string | true>();
  if (!cc) return m;
  for (const part of cc.split(",")) {
    const p = part.trim();
    if (!p) continue;
    const [k, v] = p.split("=");
    m.set(k.toLowerCase(), v === undefined ? true : v.trim().replace(/^"|"$/g, ""));
  }
  return m;
}

export function joinUpstream(base: string, url: URL) {
  const b = base.replace(/\/+$/, "");
  return b + url.pathname + url.search;
}

export function computePolicy(opts: {
  defaults: Defaults;
  rule?: Rule;
  upstream: Headers;
  status: number;
}): { shouldCache: boolean; ttlMs: number; expiresAt?: number } {
  const { defaults, rule, upstream, status } = opts;
  const cacheableStatus = [200, 203, 206, 301, 404].includes(status);
  const respect = rule?.respect_upstream ?? defaults.respect_upstream;
  const overrideTtl = (rule?.override_ttl_secs ?? defaults.override_ttl_secs) ?? undefined;

  const ccStr = upstream.get("cache-control") ?? upstream.get("Cache-Control") ?? "";
  const cc = parseCacheControl(ccStr);

  if (defaults.no_store_honored && cc.has("no-store")) return { shouldCache: false, ttlMs: 0 };
  if (defaults.private_disallowed && cc.has("private")) return { shouldCache: false, ttlMs: 0 };

  let ttlSec = overrideTtl ?? defaults.default_ttl_secs;

  if (respect) {
    if (cc.has("s-maxage")) ttlSec = Number(cc.get("s-maxage"));
    else if (cc.has("max-age")) ttlSec = Number(cc.get("max-age"));
    else if (upstream.has("Expires")) {
      const exp = Date.parse(upstream.get("Expires")!);
      if (!Number.isNaN(exp)) {
        const delta = Math.max(0, Math.floor((exp - Date.now()) / 1000));
        ttlSec = delta;
      }
    }
  }

  const ttlMs = Math.max(0, (ttlSec ?? 0) * 1000);
  const expiresAt = ttlMs > 0 ? Date.now() + ttlMs : undefined;
  return { shouldCache: cacheableStatus && ttlMs > 0, ttlMs, expiresAt };
}
