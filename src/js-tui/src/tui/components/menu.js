export class Menu {
  constructor({ items = [], selected = 0, title = "" } = {}) {
    this.items = items;
    this.selected = selected;
    this.title = title;
  }

  onKey(key) {
    if (key === "up") this.selected = Math.max(0, this.selected - 1);
    if (key === "down") this.selected = Math.min(this.items.length - 1, this.selected + 1);
    if (key === "enter") return { action: "select", index: this.selected, item: this.items[this.selected] };
    return null;
  }

  render(block, { x = 0, y = 0, w = block.w, h = block.h, styles, charset }) {
    const sTitle = styles.title;
    const sItem = styles.item;
    const sSel = styles.selected;

    block.fillRect(x, y, w, h, " ", styles.panelBg);

    let row = y;
    if (this.title) {
      block.drawText(x + 1, row, charset.render(`{bullet} ${this.title}`), sTitle);
      row += 2;
    }

    for (let i = 0; i < this.items.length && row < y + h; i++) {
      const label = String(this.items[i]);
      const isSel = i === this.selected;
      const prefix = isSel ? charset.render("{arrowR}") : " ";
      const line = `${prefix} ${label}`;
      block.drawText(x + 1, row, line.slice(0, Math.max(0, w - 2)), isSel ? sSel : sItem);
      row++;
    }
  }
}
