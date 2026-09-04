/* graph.js — canvas force-directed graph. Near-linear repulsion via a spatial
   grid, label collision rejection, hover/focus/trace, pan/zoom/drag, idle pulse.
   Canvas (not SVG) so it stays smooth well past a thousand nodes. */

const TYPE_COLORS = {
  call: "#7c6bff", note: "#b9a7d0", concept: "#ffbf5c", project: "#6a5cff",
  person: "#cf8bff", client: "#35e6a6", invoice: "#ff5c9a", proposal: "#ff9e52",
  sop: "#ffd24b", brief: "#e0d6ff", campaign: "#ff6ec7",
};
const DEFAULT_COLOR = "#9b8bc0";

class PhoenixGraph {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.nodes = [];
    this.edges = [];
    this.byId = new Map();

    this.camera = { x: 0, y: 0, zoom: 1 };
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.hoverId = null;
    this.focusId = null;
    this.traceFrom = null;
    this.tracePath = [];
    this.hiddenTypes = new Set();

    this.showLabels = true;
    this.showPulse = true;
    this.pulses = [];

    this.dragNode = null;
    this.panning = false;
    this.last = { x: 0, y: 0 };
    this.alpha = 1; // simulation energy

    this._onFocus = null; // callback(nodeId|null)
    this._bind();
    this._resize();
    window.addEventListener("resize", () => this._resize());
    this._loop();
    setInterval(() => this._maybePulse(), 2600);
  }

  onFocus(fn) { this._onFocus = fn; }

  setData(graph) {
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    this.nodes = graph.nodes.map((n, i) => {
      const a = (i / graph.nodes.length) * Math.PI * 2;
      const r = 60 + Math.random() * Math.min(W, H) * 0.32;
      return {
        ...n,
        x: W / 2 + Math.cos(a) * r,
        y: H / 2 + Math.sin(a) * r,
        vx: 0, vy: 0,
        radius: 4 + Math.sqrt(n.degree) * 2.4,
        color: TYPE_COLORS[n.type] || DEFAULT_COLOR,
      };
    });
    this.byId = new Map(this.nodes.map((n) => [n.id, n]));
    this.edges = graph.edges.filter((e) => this.byId.has(e.source) && this.byId.has(e.target));
    this.alpha = 1;
  }

  setHiddenTypes(set) { this.hiddenTypes = set; }
  setLabels(v) { this.showLabels = v; }
  setPulse(v) { this.showPulse = v; if (!v) this.pulses = []; }

  focus(id) {
    this.focusId = id;
    if (this._onFocus) this._onFocus(id);
  }

  // ---- coordinate transforms -------------------------------------------
  _resize() {
    const { canvas } = this;
    const w = window.innerWidth, h = window.innerHeight;
    canvas.width = w * this.dpr; canvas.height = h * this.dpr;
    canvas.style.width = w + "px"; canvas.style.height = h + "px";
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }
  toScreen(x, y) {
    return {
      x: (x - this.camera.x) * this.camera.zoom + window.innerWidth / 2,
      y: (y - this.camera.y) * this.camera.zoom + window.innerHeight / 2,
    };
  }
  toWorld(sx, sy) {
    return {
      x: (sx - window.innerWidth / 2) / this.camera.zoom + this.camera.x,
      y: (sy - window.innerHeight / 2) / this.camera.zoom + this.camera.y,
    };
  }

  // ---- physics: spatial grid so repulsion stays near-linear -------------
  _step() {
    if (this.alpha < 0.005) return;
    const nodes = this.nodes;
    const REPULSE = 5200, LINK = 0.012, LINK_LEN = 74, CENTER = 0.006;
    const CELL = 90;
    const grid = new Map();
    const key = (cx, cy) => cx + "," + cy;
    for (const n of nodes) {
      const cx = Math.floor(n.x / CELL), cy = Math.floor(n.y / CELL);
      const k = key(cx, cy);
      (grid.get(k) || grid.set(k, []).get(k)).push(n);
    }
    // repulsion: only against neighbours within one cell (distance cutoff)
    for (const n of nodes) {
      const cx = Math.floor(n.x / CELL), cy = Math.floor(n.y / CELL);
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        for (let gy = cy - 1; gy <= cy + 1; gy++) {
          const bucket = grid.get(key(gx, gy));
          if (!bucket) continue;
          for (const m of bucket) {
            if (m === n) continue;
            let dx = n.x - m.x, dy = n.y - m.y;
            let d2 = dx * dx + dy * dy;
            if (d2 > CELL * CELL * 4 || d2 === 0) continue;
            const d = Math.sqrt(d2) || 1;
            const f = (REPULSE / d2) * this.alpha;
            n.vx += (dx / d) * f; n.vy += (dy / d) * f;
          }
        }
      }
    }
    // springs
    for (const e of this.edges) {
      const a = this.byId.get(e.source), b = this.byId.get(e.target);
      let dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - LINK_LEN) * LINK * this.alpha;
      const fx = (dx / d) * f, fy = (dy / d) * f;
      a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
    }
    // gravity to centre + integrate
    const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
    for (const n of nodes) {
      n.vx += (cx - n.x) * CENTER * this.alpha;
      n.vy += (cy - n.y) * CENTER * this.alpha;
      if (n === this.dragNode) { n.vx = 0; n.vy = 0; continue; }
      n.x += n.vx; n.y += n.vy;
      n.vx *= 0.86; n.vy *= 0.86;
    }
    this.alpha *= 0.994;
  }

  _maybePulse() {
    if (!this.showPulse || !this.edges.length) return;
    const e = this.edges[(Math.random() * this.edges.length) | 0];
    this.pulses.push({ e, t: 0 });
  }

  // ---- render -----------------------------------------------------------
  _loop() {
    this._step();
    this._draw();
    requestAnimationFrame(() => this._loop());
  }

  _visible(n) { return !this.hiddenTypes.has(n.type); }

  _highlightSet() {
    // which nodes are "lit": hovered/focused node and neighbours, or trace path
    if (this.tracePath.length) return new Set(this.tracePath);
    const key = this.hoverId || this.focusId;
    if (!key) return null;
    const set = new Set([key]);
    for (const e of this.edges) {
      if (e.source === key) set.add(e.target);
      if (e.target === key) set.add(e.source);
    }
    return set;
  }

  _draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    const lit = this._highlightSet();
    const traceSet = this.tracePath.length ? new Set(this.tracePath) : null;

    // edges
    ctx.lineWidth = 1;
    for (const e of this.edges) {
      const a = this.byId.get(e.source), b = this.byId.get(e.target);
      if (!this._visible(a) || !this._visible(b)) continue;
      const sa = this.toScreen(a.x, a.y), sb = this.toScreen(b.x, b.y);
      let onTrace = traceSet && traceSet.has(a.id) && traceSet.has(b.id) &&
        this._adjacentInPath(a.id, b.id);
      let strong = lit && (lit.has(a.id) && lit.has(b.id));
      let alpha = lit ? (strong ? 0.5 : 0.04) : 0.12;
      if (onTrace) alpha = 0.9;
      ctx.strokeStyle = onTrace
        ? "rgba(255,191,92," + alpha + ")"
        : "rgba(176,120,255," + alpha + ")";
      ctx.lineWidth = onTrace ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.stroke();
    }

    // pulses travelling along edges
    if (this.showPulse) {
      for (let i = this.pulses.length - 1; i >= 0; i--) {
        const p = this.pulses[i];
        p.t += 0.02;
        if (p.t >= 1) { this.pulses.splice(i, 1); continue; }
        const a = this.byId.get(p.e.source), b = this.byId.get(p.e.target);
        if (!a || !b) { this.pulses.splice(i, 1); continue; }
        const x = a.x + (b.x - a.x) * p.t, y = a.y + (b.y - a.y) * p.t;
        const s = this.toScreen(x, y);
        ctx.beginPath();
        ctx.fillStyle = "rgba(207,139,255," + (1 - p.t) + ")";
        ctx.arc(s.x, s.y, 2.4, 0, Math.PI * 2); ctx.fill();
      }
    }

    // nodes
    const labelBoxes = [];
    const drawOrder = [...this.nodes].sort((a, b) => b.degree - a.degree);
    for (const n of drawOrder) {
      if (!this._visible(n)) continue;
      const s = this.toScreen(n.x, n.y);
      const r = n.radius * Math.sqrt(this.camera.zoom);
      let dim = lit && !lit.has(n.id);
      const isHover = n.id === this.hoverId;
      const isFocus = n.id === this.focusId;

      ctx.globalAlpha = dim ? 0.12 : 1;
      // glow
      if (!dim && (n.degree > 6 || isHover || isFocus)) {
        ctx.shadowColor = n.color;
        ctx.shadowBlur = isHover || isFocus ? 26 : 12;
      } else { ctx.shadowBlur = 0; }
      ctx.beginPath();
      ctx.fillStyle = n.color;
      ctx.arc(s.x, s.y, r + (isHover ? 2 : 0), 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      if (isFocus) {
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(s.x, s.y, r + 4, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // labels — most-connected first, reject colliding boxes
    if (this.showLabels) {
      ctx.font = "600 11px Sora, sans-serif";
      ctx.textBaseline = "middle";
      for (const n of drawOrder) {
        if (!this._visible(n)) continue;
        if (n.degree < 8 && n.id !== this.hoverId && n.id !== this.focusId &&
            !(traceSet && traceSet.has(n.id))) continue;
        const s = this.toScreen(n.x, n.y);
        const dim = lit && !lit.has(n.id);
        if (dim && n.id !== this.hoverId) continue;
        const text = n.label;
        const w = ctx.measureText(text).width;
        const bx = s.x + n.radius + 6, by = s.y - 7, bw = w + 6, bh = 14;
        if (this._collides(bx, by, bw, bh, labelBoxes)) continue;
        labelBoxes.push({ x: bx, y: by, w: bw, h: bh });
        ctx.fillStyle = "rgba(7,4,13,0.6)";
        ctx.fillRect(bx - 3, by, bw, bh);
        ctx.fillStyle = dim ? "rgba(239,230,255,0.5)" : "#efe6ff";
        ctx.fillText(text, bx, s.y);
      }
    }
  }

  _adjacentInPath(a, b) {
    const p = this.tracePath;
    for (let i = 0; i < p.length - 1; i++) {
      if ((p[i] === a && p[i + 1] === b) || (p[i] === b && p[i + 1] === a)) return true;
    }
    return false;
  }
  _collides(x, y, w, h, boxes) {
    for (const b of boxes) {
      if (x < b.x + b.w && x + w > b.x && y < b.y + b.h && y + h > b.y) return true;
    }
    return false;
  }

  // ---- interaction ------------------------------------------------------
  _nodeAt(sx, sy) {
    for (const n of this.nodes) {
      if (!this._visible(n)) continue;
      const s = this.toScreen(n.x, n.y);
      const r = n.radius * Math.sqrt(this.camera.zoom) + 4;
      if ((s.x - sx) ** 2 + (s.y - sy) ** 2 <= r * r) return n;
    }
    return null;
  }

  _bind() {
    const c = this.canvas;
    c.addEventListener("mousemove", (e) => {
      const sx = e.clientX, sy = e.clientY;
      if (this.dragNode) {
        const w = this.toWorld(sx, sy);
        this.dragNode.x = w.x; this.dragNode.y = w.y;
        this.alpha = Math.max(this.alpha, 0.25);
        return;
      }
      if (this.panning) {
        this.camera.x -= (sx - this.last.x) / this.camera.zoom;
        this.camera.y -= (sy - this.last.y) / this.camera.zoom;
        this.last = { x: sx, y: sy };
        return;
      }
      const n = this._nodeAt(sx, sy);
      this.hoverId = n ? n.id : null;
      c.style.cursor = n ? "pointer" : "grab";
    });
    c.addEventListener("mousedown", (e) => {
      const n = this._nodeAt(e.clientX, e.clientY);
      if (n) {
        if (e.shiftKey) { this._trace(n); return; }
        this.dragNode = n;
        this.focus(n.id);
        this.traceFrom = n.id; this.tracePath = [];
      } else {
        this.panning = true; this.last = { x: e.clientX, y: e.clientY };
        this.focus(null); this.tracePath = [];
      }
    });
    window.addEventListener("mouseup", () => { this.dragNode = null; this.panning = false; });
    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      const before = this.toWorld(e.clientX, e.clientY);
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      this.camera.zoom = Math.max(0.2, Math.min(4, this.camera.zoom * factor));
      const after = this.toWorld(e.clientX, e.clientY);
      this.camera.x += before.x - after.x;
      this.camera.y += before.y - after.y;
    }, { passive: false });
  }

  _trace(n) {
    if (!this.traceFrom || this.traceFrom === n.id) { this.traceFrom = n.id; return; }
    fetch(`/api/path?a=${encodeURIComponent(this.traceFrom)}&b=${encodeURIComponent(n.id)}`)
      .then((r) => r.json())
      .then((d) => { this.tracePath = d.path || []; });
  }

  fit() {
    if (!this.nodes.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of this.nodes) {
      if (!this._visible(n)) continue;
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x); maxY = Math.max(maxY, n.y);
    }
    const w = maxX - minX || 1, h = maxY - minY || 1;
    this.camera.x = (minX + maxX) / 2;
    this.camera.y = (minY + maxY) / 2;
    this.camera.zoom = Math.min(4, Math.max(0.2,
      0.85 * Math.min(window.innerWidth / w, window.innerHeight / h)));
  }

  focusNode(id) {
    const n = this.byId.get(id);
    if (!n) return;
    this.focus(id);
    this.traceFrom = id; this.tracePath = [];
    this.camera.x = n.x; this.camera.y = n.y;
  }
}

window.PhoenixGraph = PhoenixGraph;
window.TYPE_COLORS = TYPE_COLORS;
