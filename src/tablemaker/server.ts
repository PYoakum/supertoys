// server.ts
// Bun: bun run server.ts

// ---------- helper ----------
function buildEditableTable(
  headers: string[],
  rows: any[][],
  opts: { tableClass?: string; inputNamePrefix?: string } = {}
): string {
  if (!Array.isArray(headers) || !headers.every((h) => typeof h === "string")) {
    throw new TypeError("headers must be an array of strings");
  }
  if (!Array.isArray(rows) || !rows.every((r) => Array.isArray(r))) {
    throw new TypeError("rows must be a 2D array");
  }
  const { tableClass = "min-w-full", inputNamePrefix = "fields" } = opts;

  const esc = (s: any) =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const slug = (s: any) =>
    String(s)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");

  rows.forEach((row, i) => {
    if (row.length !== headers.length) {
      throw new Error(
        `Row ${i} has ${row.length} cells but headers has ${headers.length}`
      );
    }
  });

  const thead =
    "<thead><tr>" +
    headers.map((h) => `<th>${esc(h)}</th>`).join("") +
    "</tr></thead>";

  const tbody =
    "<tbody>" +
    rows
      .map((row, rIdx) => {
        return (
          "<tr>" +
          row
            .map((val, cIdx) => {
              const name = `${inputNamePrefix}[${rIdx}][${slug(headers[cIdx] ?? `col_${cIdx}`)}]`;
              return `<td><input class="c-input" type="text" name="${esc(
                name
              )}" value="${esc(val ?? "")}" /></td>`;
            })
            .join("") +
          "</tr>"
        );
      })
      .join("") +
    "</tbody>";

  const cls = tableClass ? ` class="${esc(tableClass)}"` : "";
  return `<table${cls} id="editable-table">${thead}${tbody}</table>`;
}

// ---------- parsing helpers ----------
function parseMaybeJSON<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function parseHeaders(raw: string | null): string[] | null {
  if (!raw) return null;
  const asJSON = parseMaybeJSON<string[]>(raw);
  if (asJSON) return asJSON;
  // CSV fallback
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function parseRows(raw: string | null): any[][] | null {
  if (!raw) return null;
  const asJSON = parseMaybeJSON<any[][]>(raw);
  if (asJSON) return asJSON;
  // compact CSV-ish: rows by ';', cells by ','
  return raw
    .split(";")
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => r.split(",").map((c) => c.trim()));
}

function htmlPage(title: string, tableHTML: string): string {
  const compiledHtml = `
  <!doctype html>
  <html lang="en-US">
    <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="𝑻𝑨𝑩𝑳𝑬𝑴𝑨𝑲𝑬𝑹 for CSV data" />
    <title>𝑻𝑨𝑩𝑳𝑬𝑴𝑨𝑲𝑬𝑹</title>
    <link rel="stylesheet" href="./style.css">
    <script src="./main.js"></script>
    </head>
    <body>
    <div class="app theme-mac" data-cmp="app-root">
      <header role="banner">
        <div class="c-header">
          <div class="c-header__bar c-window" role="navigation" aria-label="Primary">
            <strong class="c-header__brand" style="">𝑻𝑨𝑩𝑳𝑬𝑴𝑨𝑲𝑬𝑹</strong>
            <form class="c-header__search" role="search" aria-label="Site search" action="#">
              <div>
                <input id="fn-input" class="c-input" value="table.csv"/>
              </div>
              <button class="c-button" id="dl-btn">⬇︎ 𝑑𝑜𝑤𝑛𝑙𝑜𝑎𝑑</button>
            </form>
          </div>
        </div>
      </header>
      <section aria-label="generated table">
      ${tableHTML}
      </sections>
    </div>  
  </body>
</html>`;
return compiledHtml
}

// ---------- server ----------
const server = Bun.serve({
  port: process.env.PORT ? Number(process.env.PORT) : 3000,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/generate") {
      let headers: string[] | null = null;
      let rows: any[][] | null = null;

      // GET query parsing
      headers = parseHeaders(url.searchParams.get("headers"));
      rows = parseRows(url.searchParams.get("rows"));

      // POST JSON parsing (takes precedence if present)
      if (req.method === "POST" && req.headers.get("content-type")?.includes("application/json")) {
        try {
          const body = await req.json();
          if (Array.isArray(body?.headers)) headers = body.headers;
          if (Array.isArray(body?.rows)) rows = body.rows;
        } catch {
          // ignore bad JSON; will fall back to demo
        }
      }

      // Demo defaults if not provided
      if (!headers || !rows) {
        headers ??= ["Name", "Email", "Role"];
        rows ??= [
          ["Ada Lovelace", "ada@example.com", "Engineer"],
          ["Alan Turing", "alan@bletchley.uk", "Researcher"],
          ["Grace Hopper", "grace@navy.mil", "Rear Admiral"],
        ];
      }

      try {
        const table = buildEditableTable(headers, rows, {
          tableClass: "c-table",
          inputNamePrefix: "data",
        });
        return new Response(htmlPage("Generated Editable Table", table), {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      } catch (err: any) {
        const msg = err?.message ?? "Invalid input";
        return new Response(
          htmlPage("Error", `<p style="color:#b00;">${msg}</p>`),
          { status: 400, headers: { "content-type": "text/html; charset=utf-8" } }
        );
      }
    }

    // Root/help
    if (url.pathname === "/") {
      const demoUrl = new URL("/generate", url);
      demoUrl.searchParams.set("headers", JSON.stringify(["Task","Owner","Due"]));
      demoUrl.searchParams.set("rows", JSON.stringify([["Spec","Mina","2025-09-01"],["Implement","Raj","2025-09-10"]]));
      const instructions = `
        <p>Use <code>/generate</code> via GET or POST.</p>
        <p><strong>GET examples</strong></p>
        <ul>
          <li><code>/generate?headers=["Name","Email"]&rows=[["Ada","ada@x.com"],["Alan","alan@x.com"]]</code></li>
          <li><code>/generate?headers=Name,Email&rows=Ada,ada@x.com;Alan,alan@x.com</code></li>
        </ul>
        <p>Try a demo: <a href="${demoUrl.toString()}">${demoUrl.pathname + demoUrl.search}</a></p>
      `;
      return new Response(
        htmlPage("Tablemaker", instructions),
        { headers: { "content-type": "text/html; charset=utf-8" } }
      );
    }

    // static assets
    if (url.pathname === "/style.css"){
      let stylesheet = await Bun.file(__dirname+'/src/style.css')
                
        return new Response(stylesheet, {        
            headers : {
                "content-type" : "text/css"
            }
        });
    }

    if (url.pathname === "/main.js"){
      let clientScript = await Bun.file(__dirname+'/src/main.css')
                
        return new Response(clientScript, {        
            headers : {
                "content-type" : "application/javascript"
            }
        });
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`➡️  Server running at http://localhost:${server.port}`);
