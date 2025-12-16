// src/config.ts
import { parse as parseYaml } from "yaml";
import { watch } from "fs";
import { readFile } from "fs/promises";

export type StatusHeaders = { 
    cache: string; 
    key: string; 
    expires: string 
};

export type Invalidation = {
  invalidate_header: string;
  bypass_header: string;
  value_regex?: string | null;
};

export type MatchSpec = { 
    path_regex: string; 
    host?: string; 
    methods?: string[] 
};

export type Rule = {
  name: string;
  match: MatchSpec;
  key_template: string;
  respect_upstream?: boolean;
  override_ttl_secs?: number | null;
  status_headers?: StatusHeaders;
  upstream_base?: string;
};

export type Defaults = {
  respect_upstream: boolean;
  default_ttl_secs: number;
  override_ttl_secs?: number | null;
  cache_methods: string[];
  no_store_honored: boolean;
  private_disallowed: boolean;
  stale_if_error_secs?: number | null;
  status_headers: StatusHeaders;
  invalidation: Invalidation;
};

export type AppConfig = {
  upstream_base: string;
  server: { bind: string };
  defaults: Defaults;
  rules: Rule[];
};

export async function loadConfig(path: string): Promise<AppConfig> {
  const text = await readFile(path, "utf8");
  const c = parseYaml(text) as AppConfig;
  c.rules ??= [];
  return c;
}

export function hotReload(path: string, onReload: (cfg: AppConfig) => void) {
  const reload = debounce(async () => {
    try {
      const cfg = await loadConfig(path);
      onReload(cfg);
      console.log("[config] hot-reloaded");
    } catch (e) {
      console.error("[config] reload failed:", e);
    }
  }, 150);

  watch(path, { persistent: true }, reload);
}

function debounce<T extends (...args: any[]) => void>(fn: T, ms = 200) {
  let t: any;
  return (...args: Parameters<T>) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
