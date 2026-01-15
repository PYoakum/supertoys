/**
 * NDJSON streaming over fetch:
 * - reads incrementally
 * - splits by newline
 * - JSON.parse per line
 */
export async function streamNdjson(url, {
  method = "GET",
  headers = {},
  body = null,
  onObject,       // (obj) => void
  onLine,         // (line) => void (optional)
  onError,        // (err) => void
  signal          // AbortSignal
} = {}) {
  const res = await fetch(url, {
    method,
    headers: { "accept": "application/x-ndjson, application/json, text/plain", ...headers },
    body,
    signal
  });

  if (!res.ok || !res.body) {
    throw new Error(`NDJSON request failed: ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buf += decoder.decode(value, { stream: true });

    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trimEnd();
      buf = buf.slice(idx + 1);

      if (!line) continue;
      onLine?.(line);

      try {
        const obj = JSON.parse(line);
        onObject?.(obj);
      } catch (e) {
        onError?.(e);
      }
    }
  }

  // final trailing line (optional)
  const tail = buf.trim();
  if (tail) {
    onLine?.(tail);
    try { onObject?.(JSON.parse(tail)); } catch (e) { onError?.(e); }
  }

  return { ok: true };
}
