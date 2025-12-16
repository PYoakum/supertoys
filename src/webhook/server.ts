import { generateUUID } from "./src/uuid";

// ---- Configuration ----
const PORT = Number(process.env.HOOK_PORT || 3003);
// Where we forward the validated POST (could be internal or external)
const FORWARD_URL = process.env.FORWARD_URL || "http://localhost:3009/";

const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || "*"; // cors allowlist

/* 
  In-memory webhook storage (per-UUID)

  type HookMessage = { 
    timestamp: number; 
    headers: Record<string, string>; 
    body: unknown 
  }; 
*/

type HookMessage = { timestamp: number; body: unknown };
const hooks = new Map<string, HookMessage[]>();

// utility to create JSON responses
const json = (obj: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(obj), {
    headers: {
      "content-type": "application/json; charset=utf-8", 
      "access-control-allow-origin": ALLOW_ORIGIN },
    ...init
  });

// preflight + cors
function maybeHandleCors(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "access-control-allow-origin": ALLOW_ORIGIN,
        "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
        "access-control-allow-headers": "content-type,authorization",
        "access-control-max-age": "86400"
      },
      status: 204
    });
  }
  return null;
}

// route helpers
function match(pathname: string, pattern: RegExp) {
  const m = pathname.match(pattern);
  return m && m.groups ? m.groups : null;
}

// the main router
Bun.serve({
  port: PORT,
  async fetch(req) {
    const cors = maybeHandleCors(req);
    if (cors) return cors;

    const url = new URL(req.url);
    const { pathname, searchParams } = url;

    // healthcheck route
    if (req.method === "GET" && pathname === "/healthz") {
      return json({ status: "ok" });
    }

    // ingest and validate JSON, forward to another endpoint, provision a webhook
    if (req.method === "POST" && pathname === "/ingest") {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return json({ error: "Invalid JSON body" }, { status: 400 });
      }

      // safe parsing with zod
      //const parsed = PayloadSchema.parse(body);
      //console.log(body)
      const parsed = {'data': body};
      /*
      if (!parsed) {
        return json({ 
          error: "Validation failed", 
          issues: parsed.error.flatten() 
        }, { 
          status: 400 
        });
      }
        */

      // Forward to the configured endpoint
      try {
        console.error("🤞 trying [forward]", parsed.data);
        await fetch(FORWARD_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(parsed.data)
        });
      } catch (err) {
        console.error("[forward] error:", err);
        // Not fatal for provisioning; 
      }

      // generate random UUID
      const id = generateUUID();

      // Initialize hook storage
      hooks.set(id, []);

      // Construct concrete URLs for convenience
      const base = `${url.protocol}//${url.host}`;
      const hookPostUrl = `${base}/hooks/${id}`;             // external services POST here
      const hookPollUrl = `${base}/hooks/${id}/messages`;    // clients GET/poll here
      const hookDeleteUrl = `${base}/hooks/${id}`;           // clean up

      console.log(`🪝 Created Successfully!`)
      console.log(`✍️ POST: ${hookPostUrl}`)
      console.log(`📜 POLL: ${hookPollUrl}`)
      console.log(`🗑️ DELETE: ${hookDeleteUrl}`)

      return json(
        {
          id,
          webhook: {
            post_url: hookPostUrl,
            poll_url: hookPollUrl,
            delete_url: hookDeleteUrl
          }
        },
        { status: 201 }
      );
    }

    // 2) webhook receiver: external services POST here
    {
      const m = match(pathname, /^\/hooks\/(?<id>[a-f0-9-]{36})$/i);
      if (m) {
        const { id } = m as { id: string };

        if (req.method === "POST") {
          if (!hooks.has(id)) return json({ error: "Unknown webhook id" }, { status: 404 });

          let body: unknown = null;
          try {
            // Try JSON, fall back to text
            const ct = req.headers.get("content-type") || "";
            if (ct.includes("application/json")) {
              body = await req.json();
            } else {
              body = await req.text();
            }
          } catch {
            body = null;
          }

          /* uncomment this block to push headers */
          /*
          const headers: Record<string, string> = {};
          req.headers.forEach((v, k) => (headers[k] = v));
          hooks.get(id)!.push({ timestamp: Date.now(), headers, body });
          */
         
          hooks.get(id)!.push({ timestamp: Date.now(), body });
          return json({ 
            ok: true, 
            id: id, 
            postUrl: `${process.env.HOOK_PROTOCOL}://${process.env.HOOK_HOST}:${process.env.HOOK_PORT}/hooks/${id}`,
            msgUrl: `${process.env.HOOK_PROTOCOL}://${process.env.HOOK_HOST}:${process.env.HOOK_PORT}/hooks/${id}/messages` 
          });
        }

        if (req.method === "DELETE") {
          const existed = hooks.delete(id);
          return json({ deleted: existed });
        }
      }
    }

    // 3) Poll messages for a given webhook id
    {
      const m = match(pathname, /^\/hooks\/(?<id>[a-f0-9-]{36})\/messages$/i);
      if (m && req.method === "GET") {
        const { id } = m as { id: string };
        const since = Number(searchParams.get("since") || 0); // optional timestamp filter

        const queue = hooks.get(id);
        if (!queue) return json({ error: "Unknown webhook id" }, { status: 404 });

        const items = since ? queue.filter((it) => it.timestamp > since) : queue;

        return json({
          id,
          count: items.length,
          items
        });
      }
    }

    return json({ error: "Not found" }, { status: 404 });
  }
});

console.log(`🪝 webhook server listening on http://localhost:${PORT}`);
