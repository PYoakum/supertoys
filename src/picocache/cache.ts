// src/cache.ts
export type CachedEntry = {
  status: number;
  headers: Headers;
  //body: Uint8Array;
  body: any;
  expiresAt?: number; // epoch ms
  etag?: string;
  lastModified?: string;
  cacheControl?: string;
  ruleName?: string;
};

export class MemoryCache {
  private store = new Map<string, CachedEntry>();
  private byRule = new Map<string, Set<string>>();

  constructor(private max = 50_000) {}

  get(key: string): CachedEntry | undefined {
    const val = this.store.get(key);
    if (val) {
      this.store.delete(key);
      this.store.set(key, val);
    }
    return val;
  }

  set(key: string, entry: CachedEntry) {
    const prev = this.store.get(key);
    if (prev?.ruleName) {
      const set = this.byRule.get(prev.ruleName);
      if (set) {
        set.delete(key);
        if (set.size === 0) this.byRule.delete(prev.ruleName);
      }
    }
    this.store.set(key, entry);
    if (entry.ruleName) {
      let set = this.byRule.get(entry.ruleName);
      if (!set) {
        set = new Set<string>();
        this.byRule.set(entry.ruleName, set);
      }
      set.add(key);
    }

    if (this.store.size > this.max) {
      const first = this.store.keys().next().value;
      this.delete(first);
    }
  }

  delete(key: string) {
    const val = this.store.get(key);
    if (val?.ruleName) {
      const set = this.byRule.get(val.ruleName);
      if (set) {
        set.delete(key);
        if (set.size === 0) this.byRule.delete(val.ruleName);
      }
    }
    this.store.delete(key);
  }

  deleteByRule(ruleName: string): number {
    const set = this.byRule.get(ruleName);
    if (!set) return 0;
    let count = 0;
    for (const key of set) {
      this.store.delete(key);
      count++;
    }
    this.byRule.delete(ruleName);
    return count;
  }

  clearAll(): number {
    const n = this.store.size;
    this.store.clear();
    this.byRule.clear();
    return n;
  }

  size(): number {
    return this.store.size;
  }
}
