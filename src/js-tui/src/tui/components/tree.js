/**
 * Tree node shape:
 * { label: string, children?: node[], expanded?: boolean }
 */
export class Tree {
  constructor({ root, selectedPath = [0], title = "" } = {}) {
    this.root = root || { label: "root", expanded: true, children: [] };
    this.selectedPath = selectedPath;
    this.title = title;
    this._flat = [];
  }

  onKey(key) {
    this._rebuildFlat();

    const idx = this._selectedIndex();
    if (key === "up") this._selectFlat(Math.max(0, idx - 1));
    if (key === "down") this._selectFlat(Math.min(this._flat.length - 1, idx + 1));

    if (key === "right") {
      const node = this._flat[this._selectedIndex()]?.node;
      if (node && node.children?.length) node.expanded = true;
    }
    if (key === "left") {
      const node = this._flat[this._selectedIndex()]?.node;
      if (node && node.children?.length) node.expanded = false;
    }
    if (key === "enter") {
      const hit = this._flat[this._selectedIndex()];
      return hit ? { action: "activate", path: hit.path, node: hit.node } : null;
    }
    return null;
  }

  render(block, { x = 0, y = 0, w = block.w, h = block.h, styles, charset }) {
    this._rebuildFlat();

    block.fillRect(x, y, w, h, " ", styles.panelBg);

    let row = y;
    if (this.title) {
      block.drawText(x + 1, row, charset.render(`{bullet} ${this.title}`), styles.title);
      row += 2;
    }

    const selIdx = this._selectedIndex();
    const maxRows = y + h;

    for (let i = 0; i < this._flat.length && row < maxRows; i++) {
      const { node, depth } = this._flat[i];
      const isSel = i === selIdx;

      const hasKids = !!(node.children && node.children.length);
      const twist = hasKids ? (node.expanded ? charset.render("{arrowD}") : charset.render("{arrowR}")) : " ";

      const indent = " ".repeat(depth * 2);
      const line = `${indent}${twist} ${node.label}`;
      block.drawText(x + 1, row, line.slice(0, Math.max(0, w - 2)), isSel ? styles.selected : styles.item);
      row++;
    }
  }

  _rebuildFlat() {
    this._flat = [];
    walk(this.root, [], 0, this._flat);
  }

  _selectedIndex() {
    const target = this.selectedPath.join(".");
    const idx = this._flat.findIndex(f => f.path.join(".") === target);
    return idx >= 0 ? idx : 0;
  }

  _selectFlat(flatIndex) {
    const hit = this._flat[flatIndex];
    if (hit) this.selectedPath = hit.path.slice();
  }
}

function walk(node, path, depth, out) {
  out.push({ node, path, depth });
  if (node.expanded && node.children?.length) {
    for (let i = 0; i < node.children.length; i++) {
      walk(node.children[i], path.concat([i]), depth + 1, out);
    }
  }
}
