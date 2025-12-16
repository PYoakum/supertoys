import { createHash } from "crypto";

const server = Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);

    // Route 1: Echo back POST body as JSON
    if (url.pathname === "/echo" && req.method === "POST") {
      const body = await req.text();
      return Response.json({ body });
    }

    // Route 2: Return body as MD5 hash
    if (url.pathname === "/hash" && req.method === "POST") {
      const body = await req.text();
      const hash = createHash("md5").update(body).digest("hex");
      return Response.json({ hash });
    }

    // Route 3: Echo back request headers as JSON
    if (url.pathname === "/headers") {
      const headers = Object.fromEntries(req.headers.entries());
      return Response.json({ headers });
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
});

console.log(`Server running at http://localhost:${server.port}`);