// server.ts — Bun CSV↔JSON + CSV→SQL (with gzip/br)
// Run: bun run server.ts --port 8080 --delim ,

/* ===================== CLI ===================== */
type Cli = { port: number; delim: string };
function parseCli(): Cli {
  const args = Bun.argv.slice(2);
  let port = 3000;
  let delim = ",";
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--port" && args[i + 1]) {
      port = parseInt(args[++i], 10);
    } else if (a === "--delim" && args[i + 1]) {
      delim = args[++i];
    } else if (a === "--help") {
      console.log("Usage: bun run server.ts [--port <PORT>] [--delim <,|;|||tab|\\t>]");
      process.exit(0);
    }
  }
  return { port, delim };
}

/* ===================== CORS + JSON ===================== */
function cors(res: Response): Response {
  const h = new Headers(res.headers);
  h.set("Access-Control-Allow-Origin", "*");
  h.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  h.set("Access-Control-Allow-Headers", "Content-Type, X-CSV-Delimiter, X-CSV-Strict");
  return new Response(res.body, { status: res.status, headers: h });
}
function json(obj: unknown, status = 200): Response {
  return cors(
    new Response(JSON.stringify(obj), {
      status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    }),
  );
}

/* ===================== Compression (gzip / br) ===================== */
async function withCompression(req: Request, res: Response): Promise<Response> {
  const ae = req.headers.get("Accept-Encoding") || "";
  const tokens = ae.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const has = (t: string) => tokens.includes(t);
  const wantBr = has("br");
  const wantGzip = has("gzip");

  const baseHeaders = new Headers(res.headers);
  baseHeaders.append("Vary", "Accept-Encoding");

  const body = res.body;
  if (!body) return new Response(null, { status: res.status, headers: baseHeaders });

  // br first
  if (wantBr) {
    try {
      if (typeof (globalThis as any).CompressionStream !== "undefined") {
        const cs = new (globalThis as any).CompressionStream("br");
        const compressed = (body as ReadableStream<Uint8Array>).pipeThrough(cs);
        const h = new Headers(baseHeaders);
        h.set("Content-Encoding", "br");
        h.delete("Content-Length");
        return new Response(compressed, { status: res.status, headers: h });
      }
    } catch {}
    if ((Bun as any).brotliCompressSync) {
      const u8 = new Uint8Array(await new Response(body).arrayBuffer());
      const br = (Bun as any).brotliCompressSync(u8);
      const h = new Headers(baseHeaders);
      h.set("Content-Encoding", "br");
      h.delete("Content-Length");
      return new Response(br, { status: res.status, headers: h });
    }
  }

  // gzip
  if (wantGzip) {
    if (typeof (globalThis as any).CompressionStream !== "undefined") {
      try {
        const cs = new (globalThis as any).CompressionStream("gzip");
        const compressed = (body as ReadableStream<Uint8Array>).pipeThrough(cs);
        const h = new Headers(baseHeaders);
        h.set("Content-Encoding", "gzip");
        h.delete("Content-Length");
        return new Response(compressed, { status: res.status, headers: h });
      } catch {}
    }
    if ((Bun as any).gzipSync) {
      const u8 = new Uint8Array(await new Response(body).arrayBuffer());
      const gz = (Bun as any).gzipSync(u8);
      const h = new Headers(baseHeaders);
      h.set("Content-Encoding", "gzip");
      h.delete("Content-Length");
      return new Response(gz, { status: res.status, headers: h });
    }
  }

  return new Response(body, { status: res.status, headers: baseHeaders });
}

/* ===================== Request options ===================== */
function resolveDelimiter(v: string): string {
  const low = v.toLowerCase();
  if (low === "comma") return ",";
  if (low === "semicolon") return ";";
  if (low === "pipe") return "|";
  if (low === "tab" || v === "\\t") return "\t";
  if (v.length === 1) return v;
  return v; // fallback
}
function pickDelimiter(req: Request, url: URL): string | null {
  const h = req.headers.get("X-CSV-Delimiter");
  if (h) return resolveDelimiter(h);
  const q = url.searchParams.get("delim");
  if (q) return resolveDelimiter(q);
  return null;
}
function pickStrict(req: Request, url: URL): boolean {
  const h = req.headers.get("X-CSV-Strict");
  if (h != null) return /^(1|true|yes)$/i.test(h);
  const q = url.searchParams.get("strict");
  if (q != null) return /^(1|true|yes)$/i.test(q);
  return true;
}

/* ===================== Type detection ===================== */
const isoDateRe = /^\d{4}-\d{2}-\d{2}$/;
const rfc3339Re = /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
function detectValue(raw: unknown): unknown {
  const t = String(raw ?? "").trim();
  if (t === "") return null;
  const tl = t.toLowerCase();
  if (tl === "true") return true;
  if (tl === "false") return false;
  if (/^[+-]?\d+$/.test(t)) {
    const n = Number(t);
    return Number.isSafeInteger(n) ? n : t;
  }
  if (/^[+-]?(?:\d+\.\d+|\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?$/.test(t)) {
    const f = Number(t);
    if (Number.isFinite(f)) return f;
  }
  if (isoDateRe.test(t)) return t;
  if (rfc3339Re.test(t)) {
    const d = new Date(t);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return t;
}

/* ===================== Streaming CSV parser ===================== */
type CsvOpts = { strict: boolean };
class StreamingCsvParser {
  private delim: string;
  private opts: CsvOpts;
  private inQuotes = false;
  private justClosedQuote = false;
  private fieldBuf = "";
  private fieldQuoted = false;
  private record: string[] = [];

  constructor(delim: string, opts: CsvOpts) {
    if (!delim) throw new Error("delimiter required");
    this.delim = delim;
    this.opts = opts;
  }

  write(chunk: string, onRecord: (rec: string[]) => void): void {
    let i = 0;
    const n = chunk.length;
    while (i < n) {
      const c = chunk[i];
      if (this.inQuotes) {
        if (c === '"') {
          if (i + 1 < n && chunk[i + 1] === '"') {
            this.fieldBuf += '"';
            i += 2;
            continue;
          }
          this.inQuotes = false;
          this.justClosedQuote = true;
          this.fieldQuoted = true;
          i += 1;
          continue;
        } else {
          this.fieldBuf += c;
          i += 1;
          continue;
        }
      } else {
        if (this.justClosedQuote) {
          if (startsWith(chunk, i, this.delim)) {
            this.pushField();
            this.justClosedQuote = false;
            i += this.delim.length;
            continue;
          }
          if (c === "\n") {
            if (this.fieldBuf.endsWith("\r")) this.fieldBuf = this.fieldBuf.slice(0, -1);
            this.pushField();
            this.emitRecord(onRecord);
            this.justClosedQuote = false;
            i += 1;
            continue;
          }
          if (this.opts.strict) throw new Error("Invalid character after closing quote");
          this.fieldBuf += c;
          this.justClosedQuote = false;
          i += 1;
          continue;
        }
        if (c === '"') {
          if (this.fieldBuf.length > 0 && this.opts.strict) throw new Error("Quote inside unquoted field");
          this.inQuotes = true;
          i += 1;
          continue;
        }
        if (startsWith(chunk, i, this.delim)) {
          this.pushField();
          i += this.delim.length;
          continue;
        }
        if (c === "\n") {
          if (this.fieldBuf.endsWith("\r")) this.fieldBuf = this.fieldBuf.slice(0, -1);
          this.pushField();
          this.emitRecord(onRecord);
          i += 1;
          continue;
        }
        this.fieldBuf += c;
        i += 1;
        continue;
      }
    }
  }

  end(): void {
    if (this.inQuotes && this.opts.strict) throw new Error("Unterminated quoted field at EOF");
    if (this.inQuotes && !this.opts.strict) {
      this.inQuotes = false;
      this.justClosedQuote = false;
      this.fieldQuoted = true;
    }
  }

  flushRemainder(onRecord: (rec: string[]) => void): void {
    if (this.fieldBuf.length > 0 || this.record.length > 0 || this.fieldQuoted || this.justClosedQuote) {
      this.pushField();
      this.emitRecord(onRecord);
    }
  }

  private pushField(): void {
    const val = this.fieldQuoted ? this.fieldBuf : this.fieldBuf.trim();
    this.record.push(val);
    this.fieldBuf = "";
    this.fieldQuoted = false;
  }

  private emitRecord(onRecord: (rec: string[]) => void): void {
    onRecord(this.record);
    this.record = [];
  }
}
function startsWith(s: string, i: number, token: string): boolean {
  return i + token.length <= s.length && s.substr(i, token.length) === token;
}

/* ===================== JSON → CSV ===================== */
function jsonToCsv(arr: Array<Record<string, unknown>>, delim: string): string {
  if (!arr || arr.length === 0) return "";
  const headers: string[] = [];
  for (const o of arr) for (const k of Object.keys(o)) if (!headers.includes(k)) headers.push(k);
  const lines: string[] = [];
  lines.push(headers.map((h) => csvCell(h, delim)).join(delim));
  for (const o of arr) {
    lines.push(headers.map((h) => csvCell(valueToString(o[h]), delim)).join(delim));
  }
  return lines.join("\n");
}
function valueToString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
function csvCell(s: string, delim: string): string {
  const mustQuote =
    s.includes(delim) || s.includes('"') || s.includes("\n") || s.includes("\r") || s.startsWith(" ") || s.endsWith(" ");
  let out = s.replace(/"/g, '""');
  return mustQuote ? `"${out}"` : out;
}

/* ===================== CSV → SQL ===================== */
type Dialect = "sqlite" | "postgres" | "mysql";
type CellKind = "null" | "bool" | "int" | "float" | "date" | "datetime" | "text";

function classifyCell(raw: unknown): CellKind {
  const t = String(raw ?? "").trim();
  if (t === "") return "null";
  const tl = t.toLowerCase();
  if (tl === "true" || tl === "false") return "bool";
  if (/^[+-]?\d+$/.test(t)) return "int";
  if (/^[+-]?(?:\d+\.\d+|\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?$/.test(t)) return "float";
  if (isoDateRe.test(t)) return "date";
  if (rfc3339Re.test(t)) return "datetime";
  return "text";
}
function mergeKinds(a: CellKind, b: CellKind): CellKind {
  if (a === b) return a;
  const order: CellKind[] = ["null", "bool", "int", "float", "date", "datetime", "text"];
  return order[Math.max(order.indexOf(a), order.indexOf(b))] ?? "text";
}
function sqlTypeFor(kind: CellKind, dialect: Dialect): string {
  switch (dialect) {
    case "postgres":
      return { bool: "BOOLEAN", int: "BIGINT", float: "DOUBLE PRECISION", date: "DATE", datetime: "TIMESTAMPTZ", text: "TEXT" }[
        kind
      ] ?? "TEXT";
    case "mysql":
      return { bool: "BOOLEAN", int: "BIGINT", float: "DOUBLE", date: "DATE", datetime: "DATETIME", text: "TEXT" }[kind] ?? "TEXT";
    case "sqlite":
    default:
      return { bool: "INTEGER", int: "INTEGER", float: "REAL", date: "TEXT", datetime: "TEXT", text: "TEXT" }[kind] ?? "TEXT";
  }
}
function quoteIdent(id: string, dialect: Dialect): string {
  if (dialect === "mysql") return "`" + id.replace(/`/g, "``") + "`";
  return '"' + id.replace(/"/g, '""') + '"';
}
function quoteValue(kind: CellKind, raw: unknown): string {
  const t = String(raw ?? "").trim();
  if (t === "") return "NULL";
  if (kind === "bool") return /^true$/i.test(t) ? "TRUE" : "FALSE";
  if (kind === "int" || kind === "float") return t;
  return "'" + t.replace(/'/g, "''") + "'";
}
function buildSql(table: string, headers: string[], rows: string[][], dialect: Dialect): string {
  const kinds: CellKind[] = headers.map(() => "null");
  for (const row of rows) for (let i = 0; i < headers.length; i++) kinds[i] = mergeKinds(kinds[i], classifyCell(row[i] ?? ""));
  const cols = headers.map((h, i) => `${quoteIdent(h, dialect)} ${sqlTypeFor(kinds[i], dialect)}`).join(", ");
  const create = `CREATE TABLE ${quoteIdent(table, dialect)} (${cols});`;
  const idents = headers.map((h) => quoteIdent(h, dialect)).join(", ");
  const valuesLines = rows.map((row) => "(" + headers.map((_, i) => quoteValue(kinds[i], row[i] ?? "")).join(", ") + ")");
  const insert = rows.length ? `INSERT INTO ${quoteIdent(table, dialect)} (${idents}) VALUES\n  ${valuesLines.join(",\n  ")};` : "";
  return insert ? `${create}\n${insert}\n` : `${create}\n`;
}

/* ===================== Routes ===================== */
async function handleConvert(req: Request, url: URL, defaultDelim: string): Promise<Response> {
  const delim = pickDelimiter(req, url) ?? defaultDelim;
  const strict = pickStrict(req, url);
  const text = await req.text();
  if (!text.trim()) return cors(json({ error: "empty body" }, 400));

  const parser = new StreamingCsvParser(delim, { strict });
  const rows: string[][] = [];
  try {
    parser.write(text, (rec) => rows.push(rec));
    parser.end();
    parser.flushRemainder((rec) => rows.push(rec));
  } catch (e) {
    return cors(json({ error: String(e) }, 400));
  }
  if (rows.length < 1) return cors(json({ error: "no rows parsed" }, 400));

  const headers = rows[0];
  const data = rows.slice(1).map((r) => {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < headers.length; i++) obj[headers[i]] = detectValue(r[i] ?? "");
    return obj;
  });

  const res = new Response(JSON.stringify({ data, headers }), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
  return cors(res);
}

async function handleToCsv(req: Request, url: URL, defaultDelim: string): Promise<Response> {
  const delim = pickDelimiter(req, url) ?? defaultDelim;
  let bodyText: string;
  try {
    bodyText = await req.text();
  } catch {
    return cors(json({ error: "unable to read body" }, 400));
  }
  if (!bodyText.trim()) return cors(json({ error: "empty body" }, 400));

  let payload: unknown;
  try {
    payload = JSON.parse(bodyText);
  } catch (e) {
    return cors(json({ error: "invalid JSON", details: String(e) }, 400));
  }
  if (!Array.isArray(payload)) return cors(json({ error: "expected JSON array" }, 400));

  const csvStr = jsonToCsv(payload as Array<Record<string, unknown>>, delim);
  return cors(new Response(csvStr, { headers: { "Content-Type": "text/csv; charset=utf-8" } }));
}

async function handleToSql(req: Request, url: URL, defaultDelim: string): Promise<Response> {
  const table = (url.searchParams.get("table") || "").trim();
  if (!table) return cors(json({ error: "missing ?table=NAME" }, 400));
  const dialect = (url.searchParams.get("dialect") || "sqlite").toLowerCase() as Dialect;
  if (!["sqlite", "postgres", "mysql"].includes(dialect)) return cors(json({ error: "unsupported dialect" }, 400));

  const delim = pickDelimiter(req, url) ?? defaultDelim;
  const strict = pickStrict(req, url);
  const text = await req.text();
  if (!text.trim()) return cors(json({ error: "empty body" }, 400));

  const parser = new StreamingCsvParser(delim, { strict });
  const records: string[][] = [];
  try {
    parser.write(text, (rec) => records.push(rec));
    parser.end();
    parser.flushRemainder((rec) => records.push(rec));
  } catch (e) {
    return cors(json({ error: String(e) }, 400));
  }

  if (records.length === 0) return cors(json({ error: "no rows" }, 400));
  const headers = records[0];
  const rows = records.slice(1);
  const sql = buildSql(table, headers, rows, dialect);

  return cors(new Response(sql, { headers: { "Content-Type": "application/sql; charset=utf-8" } }));
}

/* ===================== Server ===================== */
const { port, delim: defaultDelim } = parseCli();

Bun.serve({
  port,
  fetch: async (req: Request): Promise<Response> => {
    const url = new URL(req.url);

    // Preflight
    if (req.method === "OPTIONS") {
      return cors(new Response(null, { status: 204 }));
    }

    // Help
    if (req.method === "GET" && url.pathname === "/") {
      const help =
        "POST CSV to /convert (CSV→JSON)\n" +
        "POST JSON to /to-csv (JSON→CSV)\n" +
        "POST CSV to /to-sql?table=NAME[&dialect=sqlite|postgres|mysql]\n" +
        "Params: ?delim=comma|semicolon|pipe|tab & strict=true|false\n";
      return cors(new Response(help, { headers: { "Content-Type": "text/plain; charset=utf-8" } }));
    }

    // Routes (compressed if client accepts)
    if (req.method === "POST" && url.pathname === "/convert") {
      const res = await handleConvert(req, url, defaultDelim);
      return withCompression(req, res);
    }
    if (req.method === "POST" && url.pathname === "/to-csv") {
      const res = await handleToCsv(req, url, defaultDelim);
      return withCompression(req, res);
    }
    if (req.method === "POST" && url.pathname === "/to-sql") {
      const res = await handleToSql(req, url, defaultDelim);
      return withCompression(req, res);
    }

    return cors(json({ error: "Not Found" }, 404));
  },
});

console.log(`csv2json-bun (TS) listening on http://127.0.0.1:${port}`);
