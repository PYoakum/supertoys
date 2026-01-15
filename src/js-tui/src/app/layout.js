export function pad(rect, p = 0) {
  const t = p.top ?? p.t ?? p.y ?? p ?? 0;
  const r = p.right ?? p.r ?? p.x ?? p ?? 0;
  const b = p.bottom ?? p.b ?? p.y ?? p ?? 0;
  const l = p.left ?? p.l ?? p.x ?? p ?? 0;
  return { x: rect.x + l, y: rect.y + t, w: Math.max(0, rect.w - l - r), h: Math.max(0, rect.h - t - b) };
}

export function dock(rect, specs) {
  // specs = [{ pos:"left"|"right"|"top"|"bottom"|"fill", size:number, id }, ...]
  // Returns { frames: Map(id->rect), remaining: rect }
  let r = { ...rect };
  const frames = new Map();

  for (const s of specs) {
    if (s.pos === "left") {
      const w = clamp(s.size, 0, r.w);
      frames.set(s.id, { x: r.x, y: r.y, w, h: r.h });
      r = { x: r.x + w, y: r.y, w: r.w - w, h: r.h };
    } else if (s.pos === "right") {
      const w = clamp(s.size, 0, r.w);
      frames.set(s.id, { x: r.x + (r.w - w), y: r.y, w, h: r.h });
      r = { x: r.x, y: r.y, w: r.w - w, h: r.h };
    } else if (s.pos === "top") {
      const h = clamp(s.size, 0, r.h);
      frames.set(s.id, { x: r.x, y: r.y, w: r.w, h });
      r = { x: r.x, y: r.y + h, w: r.w, h: r.h - h };
    } else if (s.pos === "bottom") {
      const h = clamp(s.size, 0, r.h);
      frames.set(s.id, { x: r.x, y: r.y + (r.h - h), w: r.w, h });
      r = { x: r.x, y: r.y, w: r.w, h: r.h - h };
    } else if (s.pos === "fill") {
      frames.set(s.id, { ...r });
      // no remaining
    }
  }

  return { frames, remaining: r };
}

export function splitRow(rect, sizes) {
  // sizes: array of fixed widths or fractions like { frac: 0.3 }
  const out = [];
  let x = rect.x;
  let wRemain = rect.w;

  const fixed = sizes.filter(s => typeof s === "number").reduce((a, b) => a + b, 0);
  const fracs = sizes.filter(s => typeof s === "object" && s && s.frac != null);
  const fracTotal = fracs.reduce((a, s) => a + s.frac, 0);
  const fracSpace = Math.max(0, rect.w - fixed);

  for (const s of sizes) {
    let w;
    if (typeof s === "number") w = clamp(s, 0, wRemain);
    else w = clamp(Math.floor(fracSpace * (s.frac / (fracTotal || 1))), 0, wRemain);

    out.push({ x, y: rect.y, w, h: rect.h });
    x += w;
    wRemain -= w;
  }
  return out;
}

export function splitCol(rect, sizes) {
  const out = [];
  let y = rect.y;
  let hRemain = rect.h;

  const fixed = sizes.filter(s => typeof s === "number").reduce((a, b) => a + b, 0);
  const fracs = sizes.filter(s => typeof s === "object" && s && s.frac != null);
  const fracTotal = fracs.reduce((a, s) => a + s.frac, 0);
  const fracSpace = Math.max(0, rect.h - fixed);

  for (const s of sizes) {
    let h;
    if (typeof s === "number") h = clamp(s, 0, hRemain);
    else h = clamp(Math.floor(fracSpace * (s.frac / (fracTotal || 1))), 0, hRemain);

    out.push({ x: rect.x, y, w: rect.w, h });
    y += h;
    hRemain -= h;
  }
  return out;
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v | 0));
}
