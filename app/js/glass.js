// Pointer-reactive card surfaces, the "glass plates" from the landing page,
// brought into the app.
//
// What this does: while the cursor is over a card, a soft specular highlight
// follows it across the surface, the edge nearest the cursor brightens, and
// clickable cards tip a few degrees away from the hand. All of it is four CSS
// custom properties (see the "glass surfaces" block in css/styles.css), this
// file measures, the stylesheet decides what that means visually.
//
// Two things it deliberately does NOT do, unlike the landing page version:
//
//   No idle drift. On the sales page the cards float gently because nobody is
//   trying to hit them. In here they are tap targets. A target that is moving
//   while someone aims at it, on a phone, on a bumpy ride, one-handed, is
//   worse than a still one no matter how good it looks.
//
//   No see-through glass. Making these translucent would cost contrast on the
//   text that matters most in this app: a phone number, a price, a follow-up
//   date. So the cards stay fully opaque and are polished instead. Black glass
//   rather than clear glass.
//
// ONE delegated listener, not one per card. Views in this app re-render their
// whole contents constantly (every realtime update replaces the DOM), so
// per-element listeners would be attached to elements that no longer exist
// within seconds and would have to be re-bound after every single render.
// Listening on the document instead means this is set up once, at startup, and
// keeps working for every card any view ever draws.

// Which surfaces react. Both are opaque cards; see styles.css for why the
// tilt is then narrowed to just the ones you can actually click.
const SELECTOR = ".card, .prospect-card";

// Degrees. A third of the landing page's tilt on purpose: that page is a shop
// window and can afford theatre, this is a tool someone stares at all day, and
// a tilt you consciously notice on the hundredth prospect card is a tilt
// that's too big.
const MAX_TILT = 3;

// How far the bright rim shifts toward the cursor's edge, in pixels.
const RIM_SHIFT = 3;

// How long the highlight takes to fade out. Must match the --glass-lit
// transition in styles.css, since that's what this is waiting for.
const FADE_MS = 360;

let current = null;
let frame = 0;
let pending = null;

export function initGlass() {
  const mq = window.matchMedia;
  if (!mq) return;

  // Nothing to track without a hovering pointer, and a tilt that can only be
  // triggered by a tap isn't worth a listener on every touch move.
  if (!mq("(hover: hover) and (pointer: fine)").matches) return;

  // Someone who has asked their device to reduce motion gets none of this.
  // Not a slower version, none. Same rule the rest of the app follows.
  if (mq("(prefers-reduced-motion: reduce)").matches) return;

  document.addEventListener("pointermove", onPointerMove, { passive: true });
  // Cursor left the window entirely: no pointermove will ever arrive to tell
  // us the card is no longer hovered, so it would stay lit indefinitely.
  document.addEventListener("pointerout", (e) => {
    if (!e.relatedTarget) release();
  }, { passive: true });
}

function onPointerMove(e) {
  if (e.pointerType === "touch") return;
  const target = e.target;
  const el = target && target.closest ? target.closest(SELECTOR) : null;

  if (el !== current) {
    release();
    current = el;
    if (el) {
      el.classList.add("is-lit");
      // Clear any leftover fade-out override from a previous visit, so the
      // highlight comes back up instead of staying pinned at zero.
      el.style.removeProperty("--glass-lit");
    }
  }
  if (!el) return;

  // At most one update per painted frame. pointermove fires far more often
  // than the screen refreshes and every extra one is measured then thrown away.
  pending = { el: el, x: e.clientX, y: e.clientY };
  if (!frame) frame = requestAnimationFrame(apply);
}

function apply() {
  frame = 0;
  const p = pending;
  pending = null;
  // The view may have re-rendered out from under us between the pointermove
  // and this frame, which leaves us holding a detached element.
  if (!p || !p.el.isConnected) return;

  const r = p.el.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const fx = (p.x - r.left) / r.width;
  const fy = (p.y - r.top) / r.height;
  const s = p.el.style;

  // Where the highlight sits, as a percentage across the card.
  s.setProperty("--mx", (fx * 100).toFixed(1) + "%");
  s.setProperty("--my", (fy * 100).toFixed(1) + "%");

  // Which way the card leans. Away from the cursor, the way a real pane would
  // pivot if you pressed a corner of it.
  s.setProperty("--rx", ((0.5 - fy) * 2 * MAX_TILT).toFixed(2) + "deg");
  s.setProperty("--ry", ((fx - 0.5) * 2 * MAX_TILT).toFixed(2) + "deg");

  // Which edge lights up. This is drawn as an inset shadow, and an inset
  // shadow pushed left exposes, and therefore brightens, the RIGHT edge, so
  // the offsets are negated to land the light on the edge nearest the cursor.
  s.setProperty("--gx", (-(fx - 0.5) * 2 * RIM_SHIFT).toFixed(2) + "px");
  s.setProperty("--gy", (-(fy - 0.5) * 2 * RIM_SHIFT).toFixed(2) + "px");
}

// Let go of whichever card is currently lit, and let it settle.
//
// The class can't simply come off: the tilt lives on `.is-lit`, so removing it
// would delete the transform declaration outright and the card would snap flat
// instead of easing back. So the angles go to zero and the highlight is faded
// out via an inline override (inline beats the class), and only once that has
// finished does the class actually come off.
function release() {
  const el = current;
  current = null;
  if (!el) return;

  el.style.setProperty("--rx", "0deg");
  el.style.setProperty("--ry", "0deg");
  el.style.setProperty("--gx", "0px");
  el.style.setProperty("--gy", "0px");
  el.style.setProperty("--glass-lit", "0");

  window.setTimeout(() => {
    // Re-entered in the meantime? Then this card is somebody's business again
    // and stripping its state now would blank a highlight that's in use.
    if (current === el) return;
    el.classList.remove("is-lit");
    el.style.removeProperty("--mx");
    el.style.removeProperty("--my");
    el.style.removeProperty("--rx");
    el.style.removeProperty("--ry");
    el.style.removeProperty("--gx");
    el.style.removeProperty("--gy");
    el.style.removeProperty("--glass-lit");
  }, FADE_MS);
}
