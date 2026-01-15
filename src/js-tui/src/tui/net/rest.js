export async function restJson(url, { method = "GET", headers = {}, body = null } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      "accept": "application/json",
      ...(body ? { "content-type": "application/json" } : {}),
      ...headers
    },
    body: body ? JSON.stringify(body) : null
  });

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  return { ok: res.ok, status: res.status, headers: res.headers, data, text };
}
