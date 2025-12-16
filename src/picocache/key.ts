// src/key.ts
const tokenRe = /\{([^}]+)\}/g;

export function buildKey(req: Request, url: URL, template: string): string {
  const method = req.method;
  const host = req.headers.get("host") ?? "";
  let out = "";
  let last = 0;

  for (const m of template.matchAll(tokenRe)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    out += template.slice(last, start);
    const key = m[1];

    let val = "";
    
    if (key === "method") val = method;
    else if (key === "host") val = host;
    else if (key === "path") val = url.pathname;
    else if (key === "query") val = url.search.slice(1);
    else if (key.startsWith("query.")) val = url.searchParams.get(key.slice(6)) ?? "";
    else if (key.startsWith("header.")) val = req.headers.get(key.slice(7)) ?? "";
    else throw new Error(`unknown token: ${key}`);

    out += val;
    last = end;
  }
  out += template.slice(last);
  return out;
}
