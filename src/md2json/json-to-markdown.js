/**
 * json-to-markdown.js
 * Export a strict JSON-to-Markdown serializer
 */

export default function jsonToMarkdownStrict(ast, options = {}) {
  if (!ast || ast.type !== "root") throw new Error("Expected a root AST node");
  const bullet = options.bullet || "-";

  const escapeText = (s) => {
    // Escape Markdown syntax in plain text contexts
    return s
      .replace(/([\\`*_{}\[\]()#+\-.!>|~])/g, "\\$1");
  };

  const fenceForCode = (code, preferred = "```") => {
    // If code contains preferred fence, switch to tildes, else use preferred
    const hasBackticks = /```/.test(code);
    if (preferred === "```" && hasBackticks) return "~~~";
    const hasTildes = /~~~/.test(code);
    if (preferred === "~~~" && hasTildes) return "```";
    return preferred;
  };

  const fenceForInline = (code) => {
    // Choose the shortest backtick fence that doesn't appear in code
    const max = Math.max(1, (code.match(/`+/g) || []).reduce((m, s) => Math.max(m, s.length), 0));
    return "`".repeat(max + 1);
  };

  const renderInline = (nodes = []) =>
    nodes.map(n => {
      switch (n.type) {
        case "text":
          return escapeText(n.value || "");
        case "strong":
          return `**${renderInline(n.children)}**`;
        case "emphasis":
          return `*${renderInline(n.children)}*`;
        case "inlineCode": {
          const val = (n.value || "").replace(/\r\n?/g, "\n");
          // If value has backticks or leading/trailing space, use long fence and pad with spaces
          const fence = fenceForInline(val);
          const needsPadding = /^\s|\s$/.test(val);
          return needsPadding ? `${fence} ${val} ${fence}` : `${fence}${val}${fence}`;
        }
        case "link": {
          const title = n.title ? ` "${n.title.replace(/"/g, '\\"')}"` : "";
          return `[${renderInline(n.children)}](${(n.url || "").replace(/\s/g, "%20")}${title})`;
        }
        case "image": {
          const title = n.title ? ` "${n.title.replace(/"/g, '\\"')}"` : "";
          const alt = (n.alt || "").replace(/]/g, "\\]");
          return `![${alt}](${(n.url || "").replace(/\s/g, "%20")}${title})`;
        }
        default:
          return "";
      }
    }).join("");

  const renderBlocks = (nodes = [], ctx = { inList: false, indent: 0 }) => {
    const out = [];
    nodes.forEach((node, idx) => {
      switch (node.type) {
        case "heading": {
          const depth = Math.min(6, Math.max(1, node.depth || 1));
          out.push(`${"#".repeat(depth)} ${renderInline(node.children)}`.trimEnd());
          break;
        }
        case "paragraph": {
          out.push(renderInline(node.children).trimEnd());
          break;
        }
        case "code": {
          const code = (node.value || "").replace(/\r\n?/g, "\n");
          const fence = fenceForCode(code, node.fence || "```");
          const lang = node.lang ? " " + node.lang.trim() : "";
          out.push(`${fence}${lang}\n${code}\n${fence}`);
          break;
        }
        case "blockquote": {
          const inner = renderBlocks(node.children, { inList: false, indent: 0 });
          const quoted = inner
            .split("\n")
            .map(line => (line.length ? `> ${line}` : ">"))
            .join("\n");
          out.push(quoted);
          break;
        }
        case "list": {
          const ordered = !!node.ordered;
          const start = ordered && node.start && node.start !== 1 ? node.start : 1;
          const items = node.items || [];
          const isTight = node.tight !== undefined ? node.tight :
            items.every(it => it.children.length === 1 && it.children[0].type === "paragraph");

          items.forEach((it, idx2) => {
            const marker = ordered ? `${start + idx2}. ` : `${bullet} `;
            const itemPrefix = " ".repeat(ctx.indent) + marker;
            const subCtx = { inList: true, indent: ctx.indent + marker.length };
            if (isTight && it.children.length === 1 && it.children[0].type === "paragraph") {
              // Single line
              out.push(itemPrefix + renderInline(it.children[0].children).trimEnd());
            } else {
              // Loose item: each block on its own, subsequent lines indented
              const rendered = renderBlocks(it.children, subCtx);
              const lines = rendered.split("\n");
              if (lines.length === 0) {
                out.push(itemPrefix.trimEnd());
              } else {
                out.push(
                  itemPrefix + (lines[0] || ""),
                  ...lines.slice(1).map(l => (l ? " ".repeat(subCtx.indent) + l : ""))
                );
              }
            }
          });
          break;
        }
        case "thematicBreak": {
          out.push("---");
          break;
        }
        default:
          // ignore unknowns
          break;
      }
    });

    // Join with blank lines between blocks unless we're inside a list and already handled spacing
    return out.join("\n\n").replace(/\n{3,}/g, "\n\n");
  };

  return renderBlocks(ast.children);
}
