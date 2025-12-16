export default function markdownToJsonStrict(md) {
  const EOL = "\n";
  const src = md.replace(/\r\n?/g, "\n");
  const lines = src.split("\n");
  let i = 0;

  const root = { type: "root", children: [] };

  // Parsing state for list nesting
  const blockStack = [{ container: root, indent: 0 }];

  // Utilities
  const at = () => (i < lines.length ? lines[i] : null);
  const eat = () => lines[i++];

  const pushBlock = (node) => {
    blockStack[blockStack.length - 1].container.children.push(node);
  };

  const isThematicBreak = (line) =>
    /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(line);

  // Headings: ATX only here (setext underlines can be added if needed)
  const matchHeading = (line) => {
    const m = /^ {0,3}(#{1,6})[ \t]+(.+?)\s*#*\s*$/.exec(line);
    if (!m) return null;
    return { depth: m[1].length, text: m[2] };
  };

  // Code fences
  const fenceOpen = (line) => {
    const m = /^ {0,3}(`{3,}|~{3,})\s*([\w+-]*)\s*$/.exec(line);
    if (!m) return null;
    return { fence: m[1], lang: m[2] || "" };
  };

  const fenceClose = (line, fence) => {
    const re = new RegExp("^ {0,3}(" + fence[0] + "{" + fence.length + ",})\\s*$");
    return re.test(line);
  };

  // Lists
  const listMarker = (line) => {
    // capture leading spaces for indent, then marker
    const m =
      /^(\s*)(?:([*+-])\s+|(\d+)([.)])\s+)/.exec(line);
    if (!m) return null;
    const indent = m[1].length;
    if (m[2]) return { indent, ordered: false, bullet: m[2], raw: m[0] };
    return {
      indent,
      ordered: true,
      startNum: parseInt(m[3], 10),
      delimiter: m[4],
      raw: m[0]
    };
  };

  const paragraphBuffer = [];
  const flushParagraph = () => {
    if (!paragraphBuffer.length) return;
    const text = paragraphBuffer.join(" ").replace(/[ \t]+/g, " ").trim();
    if (text.length) pushBlock({ type: "paragraph", children: parseInlineStrict(text) });
    paragraphBuffer.length = 0;
  };

  const closeToIndent = (indent) => {
    // Close lists/quotes until top has indent <= target
    while (blockStack.length > 1 && blockStack[blockStack.length - 1].indent > indent) {
      const ctx = blockStack.pop();
      // Finish tight detection for lists: if any item has multiple block children or a blank line, it's loose
      if (ctx.container.type === "list" && ctx.container.items.length) {
        ctx.container.tight = detectListTight(ctx.container);
      }
    }
  };

  function detectListTight(list) {
    // Loose if any item has >1 blocks or any blank-line-separated blocks were observed (tracked via paragraph boundaries).
    // Heuristic: paragraph blocks inside items => tight unless there are additional blocks.
    return list.items.every(it => it.children.length === 1 && it.children[0].type === "paragraph");
  }

  while (i <= lines.length) {
    const line = at();

    // End of file => flush
    if (line === null) {
      flushParagraph();
      closeToIndent(0);
      break;
    }

    // Blank line
    if (/^\s*$/.test(line)) {
      flushParagraph();
      // Blank line loosens list items; we approximate by allowing additional blocks after this
      // Do not forcibly close containers; keep nesting open for following blocks
      i++;
      continue;
    }

    // Thematic break
    if (isThematicBreak(line)) {
      flushParagraph();
      pushBlock({ type: "thematicBreak" });
      i++;
      continue;
    }

    // Heading
    const h = matchHeading(line);
    if (h) {
      flushParagraph();
      pushBlock({
        type: "heading",
        depth: h.depth,
        children: parseInlineStrict(h.text)
      });
      i++;
      continue;
    }

    // Fenced code
    const f = fenceOpen(line);
    if (f) {
      flushParagraph();
      const fence = f.fence;
      const lang = f.lang;
      i++;
      const buf = [];
      while (i < lines.length && !fenceClose(at(), fence)) {
        buf.push(eat());
      }
      // eat closing fence if present
      if (i < lines.length) i++;
      pushBlock({ type: "code", lang, value: buf.join("\n"), fence });
      continue;
    }

    // Blockquote
    if (/^ {0,3}>\s?/.test(line)) {
      flushParagraph();
      // Open quote container
      const quote = { type: "blockquote", children: [] };
      pushBlock(quote);
      blockStack.push({ container: quote, indent: 0 });

      // Collect contiguous quote lines, recursively parsing inner blocks
      const sub = [];
      while (i < lines.length && /^ {0,3}>\s?/.test(at())) {
        const l = eat().replace(/^ {0,3}>\s?/, "");
        sub.push(l);
      }
      // Parse the inner content by recursion
      const inner = markdownToJsonStrict(sub.join("\n"));
      quote.children.push(...inner.children);
      // Close quote
      blockStack.pop();
      continue;
    }

    // Lists (supports nesting by indent)
    const lm = listMarker(line);
    if (lm) {
      flushParagraph();
      const currIndent = lm.indent;

      // Adjust stack to current indent
      closeToIndent(currIndent);

      let top = blockStack[blockStack.length - 1];

      // If top is not a matching list at same indent, open one
      let listNode;
      if (
        top.container.type === "list" &&
        top.indent === currIndent &&
        top.container.ordered === !!lm.ordered
      ) {
        listNode = top.container;
      } else {
        // Open a new list
        listNode = {
          type: "list",
          ordered: !!lm.ordered,
          items: []
        };
        if (lm.ordered && lm.startNum && lm.startNum !== 1) listNode.start = lm.startNum;
        pushBlock(listNode);
        blockStack.push({ container: listNode, indent: currIndent });
        top = blockStack[blockStack.length - 1];
      }

      // Start a new list item
      const item = { children: [] };
      listNode.items.push(item);

      // Parse the rest of the first line as paragraph content
      let content = line.slice(lm.raw.length);
      const following = [];

      // Gather following lines that belong to this list item (lookahead until a less/equal indent non-blank, non-continuation)
      i++;
      // pull continuation lines (indented >= currIndent + 2) or blank lines
      while (i < lines.length) {
        const look = at();
        if (look === null) break;
        if (/^\s*$/.test(look)) {
          following.push(eat());
          continue;
        }
        const contIndent = (/^(\s*)/.exec(look) || [,""])[1].length;
        const isAnotherItem = !!listMarker(look) && contIndent <= currIndent;
        if (isAnotherItem) break;
        // Continuation for current item if sufficiently indented or it's a paragraph continuation
        if (contIndent > currIndent) {
          following.push(eat());
        } else {
          // Paragraph continuation line for same item (no new marker and same indent)
          following.push(eat());
        }
      }

      const itemBlockText = [content, ...following].join("\n").replace(/\s+$/,"");

      // Recursively parse the item's blocks
      const parsedItem = markdownToJsonStrict(itemBlockText);
      item.children.push(...parsedItem.children);

      continue;
    }

    // Otherwise: paragraph line (collect until blank or block boundary)
    paragraphBuffer.push(line.trim());
    i++;
  }

  return root;

  // ---------- Inline parsing (stricter) ----------
  function parseInlineStrict(text) {
    // Tokenizer with a simple stack for emphasis/strong; link/image parsing with optional title
    const tokens = [];
    let i = 0;

    const pushText = (t) => {
      if (!t) return;
      if (tokens.length && tokens[tokens.length - 1].type === "text") {
        tokens[tokens.length - 1].value += t;
      } else {
        tokens.push({ type: "text", value: t });
      }
    };

    const readUntil = (s, start, ch) => {
      let j = start;
      while (j < s.length) {
        if (s[j] === "\\" && j + 1 < s.length) { j += 2; continue; }
        if (s[j] === ch) return j;
        j++;
      }
      return -1;
    };

    const parseLinkOrImage = () => {
      const isImg = text[i] === "!" && text[i+1] === "[";
      let j = isImg ? i + 2 : i + 1;
      const endAlt = readUntil(text, j, "]");
      if (endAlt === -1) return null;
      const alt = text.slice(j, endAlt);

      if (text[endAlt + 1] !== "(") return null;
      j = endAlt + 2;
      // parse url and optional title (title may be "..." or '...' or (...) no spaces inside)
      let k = j;
      let url = "";
      let title = undefined;
      // URL ends at first unescaped ')' or a space followed by quoted title
      // Grab raw until ')', then split if quoted title present
      // Simple heuristic
      let parenDepth = 1;
      while (k < text.length && parenDepth > 0) {
        if (text[k] === "\\" && k + 1 < text.length) { k += 2; continue; }
        if (text[k] === "(") { parenDepth++; k++; continue; }
        if (text[k] === ")") { parenDepth--; if (parenDepth===0) break; k++; continue; }
        k++;
      }
      if (parenDepth !== 0) return null;
      const inside = text.slice(j, k).trim();
      // Try to split url and title
      const titleMatch = inside.match(/^(\S+)\s+(".*?"|'.*?')\s*$/);
      if (titleMatch) {
        url = titleMatch[1];
        title = titleMatch[2].slice(1, -1);
      } else {
        url = inside;
      }

      const node = isImg
        ? { type: "image", url, alt, ...(title ? { title } : {}) }
        : { type: "link", url, ...(title ? { title } : {}), children: markdownToJsonStrict(alt).children.length
              ? markdownToJsonStrict(alt).children[0].children // allow inline formatting in link text
              : [{ type: "text", value: alt }] };

      i = k + 1; // after ')'
      return node;
    };

    // emphasis/strong stack
    const stack = [];

    while (i < text.length) {
      const ch = text[i];

      // escapes
      if (ch === "\\" && i + 1 < text.length) {
        pushText(text[i + 1]);
        i += 2;
        continue;
      }

      // inline code (support multiple backticks)
      if (ch === "`") {
        const m = /^`+/.exec(text.slice(i));
        const ticks = m[0].length;
        const fence = "`".repeat(ticks);
        const close = text.indexOf(fence, i + ticks);
        if (close !== -1) {
          const value = text.slice(i + ticks, close);
          tokens.push({ type: "inlineCode", value });
          i = close + ticks;
          continue;
        }
      }

      // image/link
      if (ch === "!" && text[i+1] === "[" || ch === "[") {
        const node = parseLinkOrImage();
        if (node) {
          tokens.push(node);
          continue;
        }
      }

      // strong/emphasis
      if (ch === "*" || ch === "_") {
        const dbl = text[i+1] === ch;
        const marker = dbl ? ch + ch : ch;
        // find closing marker
        const close = text.indexOf(marker, i + marker.length);
        if (close !== -1) {
          const inner = text.slice(i + marker.length, close);
          const children = parseInlineStrict(inner);
          tokens.push(dbl ? { type: "strong", children } : { type: "emphasis", children });
          i = close + marker.length;
          continue;
        }
      }

      // plain text
      pushText(ch);
      i++;
    }

    return tokens;
  }
}
