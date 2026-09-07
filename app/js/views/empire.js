import { store, on, nicheById, nicheHue, profileById } from "../state.js";
import { el, esc, money, fmtDate } from "../utils.js";
import { openProspectDetail } from "./prospectDetail.js";

// The Empire is a picture of the agency, not a game with its own economy.
// Every building on this street is a real signed client, its colour is that
// client's real niche, its height is that client's real monthly value, and
// the name on the door is the teammate who actually signed it. Nothing here
// can be earned by playing with it — the only way to put up a building is to
// sign a client, which is exactly the point. That also means it can never go
// stale or drift out of agreement with the rest of the app: delete a client
// and the building comes down on the next render.
//
// Drawn entirely with SVG shapes rather than sprite art, deliberately. The
// team is on Zimbabwean mobile data and the whole app is currently 1.5MB with
// no images beyond the launcher icons; a tileset would have been the single
// largest thing we ship, downloaded again on every redeploy, for decoration.
//
// The street is drawn in ISOMETRIC rather than flat elevation. That is worth
// the extra geometry for one specific reason: a flat side-on street of
// coloured rectangles of varying height is a bar chart, and people read it as
// one — they compare the bars instead of looking at the town. Turning the
// boxes corner-on breaks that reading instantly. It also buys two visible
// faces per building instead of one, so a building can have a lit side and a
// shaded side and stop looking like a flat swatch of niche colour.
//
// The whole town sits on one floating paving slab rather than on a horizon
// with sky above and ground below. A horizon has to be drawn to the full
// width of the canvas, which meant a three-client town got a lot of empty
// field; an island is the same object at any size, and it is centred in the
// sky when the town is shorter than the card.
//
// Everyone on the street is a real teammate, with their name in the tooltip.
// There are deliberately no anonymous extra townspeople: the first question
// anyone asks about a figure in this drawing is "who's that", and "nobody" is
// a bad answer. The trees, benches, bikes and the market cart do the work of
// making it feel inhabited instead, because nobody asks who owns a bench.

// ---- isometric geometry --------------------------------------------------
// ISO is how far the drawing drops in y for every pixel it travels in x along
// either of the two horizontal axes. 0.5 is the classic 2:1 "video game
// isometric": it is the one ratio where every diagonal advances a whole pixel
// across for every half pixel down, so long edges stay crisp instead of
// crawling, and it needs no trigonometry anywhere in this file.
const ISO = 0.5;

const FRONT_W = 58;   // the right-hand wall: the front, with the door
const SIDE_W = 38;    // the left-hand wall: the side, lit
const SLOT_W = FRONT_W + SIDE_W;
const GAP = 44;       // room between buildings for trees, benches, the cart
const PITCH = SLOT_W + GAP;
const PAD_X = 56;     // slab overhang at each end of the street

const BASE_Y = 286;        // the near, bottom corner of every building
const SLAB_BACK_Y = 232;   // back edge of the paving slab
const SLAB_FRONT_Y = 306;  // front edge, where the slab turns down
const SLAB_BOT_Y = 320;    // bottom of the slab's visible thickness
const SLAB_BEV = 60;       // how far the slab's ends slope in
const PERSON_Y = 300;      // teammates stand near the front edge
const PILL_Y = 306;        // name plate, straddling the slab's front edge
const TOTAL_H = 350;

const MIN_H = 86;
const MAX_H = 168;
const RIM = 6;         // parapet wall standing proud of each flat roof
const GROUND_H = 34;   // ground floor: door and shopfront window
const FLOOR_H = 30;    // nominal storey height; the real one is fitted to h

// Stable per-client pseudo-randomness. Roof inset, window pattern, which
// windows are lit and which have flower boxes all key off this, so a given
// client always gets the same building — a town that reshuffled itself on
// every render would read as broken rather than alive.
function hashOf(str) {
  let h = 2166136261;
  for (let i = 0; i < String(str).length; i++) {
    h ^= String(str).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function n1(v) { return Math.round(v * 10) / 10; }
function pt(x, y) { return `${n1(x)},${n1(y)}`; }

// A point on one of a building's two visible walls. `dir` is +1 for the
// right-hand wall and -1 for the left-hand one; `u` runs along the wall away
// from the shared near edge and `v` runs straight up it. Expressing both walls
// from the same origin is what makes the box meet cleanly at its near corner —
// there is no seam to fudge, because both walls are literally computed from
// the same two numbers.
function wallPt(x, y, dir, u, v) { return [x + dir * u, y - u * ISO - v]; }

function wallQuad(x, y, dir, u1, u2, v1, v2) {
  return [[u1, v1], [u2, v1], [u2, v2], [u1, v2]]
    .map(([u, v]) => { const p = wallPt(x, y, dir, u, v); return pt(p[0], p[1]); })
    .join(" ");
}

// The flat top of a box. It is a diamond rather than a rectangle because both
// of its horizontal axes are sloped — this one function draws every roof, the
// footprint, and every cast shadow.
function diamond(x, y, fw, sw) {
  return [[x, y], [x + fw, y - fw * ISO], [x + fw - sw, y - (fw + sw) * ISO], [x - sw, y - sw * ISO]]
    .map(([px, py]) => pt(px, py))
    .join(" ");
}

// Signed clients, oldest first, so the street reads left-to-right as the
// agency's history — the founding client is nearest the start of the road.
function townClients() {
  return store.prospects
    .filter((p) => p.status === "signed")
    .slice()
    .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
}

// A flower box hanging off a windowsill. Drawn in plain screen space rather
// than on the wall's plane on purpose: it sticks out of the building towards
// the viewer, so it is the one part of the facade that should NOT be sheared.
function flowerBox(x, y, dir, u1, u2, v) {
  const a = wallPt(x, y, dir, u1 - 1, v - 1);
  const b = wallPt(x, y, dir, u2 + 1, v - 1);
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  return `<g class="emp-box">
    <polygon class="emp-box-pot" points="${pt(a[0], a[1])} ${pt(b[0], b[1])} ${pt(b[0], b[1] + 5)} ${pt(a[0], a[1] + 5)}"/>
    <circle class="emp-leaf-a" cx="${n1(mx)}" cy="${n1(my - 1.6)}" r="2.9"/>
    <circle class="emp-leaf-b" cx="${n1(a[0] + 1.5)}" cy="${n1(a[1] - 0.6)}" r="2.2"/>
    <circle class="emp-leaf-b" cx="${n1(b[0] - 1.5)}" cy="${n1(b[1] - 0.6)}" r="2.2"/>
  </g>`;
}

function buildingSVG(p, x, h, hue) {
  const seed = hashOf(p.id);
  const y = BASE_Y;
  const wallTop = h + RIM;   // walls run past the roof line to form the parapet
  const roofY = y - wallTop;

  // Storeys are fitted rather than stacked. Dividing the wall evenly means a
  // short building gets short storeys and a tall one gets tall ones, and
  // neither is left with a random band of blank wall under the roof — which is
  // what happens if you stack a fixed floor height into a height that came
  // from someone's monthly retainer and was never going to divide neatly.
  const floors = Math.max(1, Math.round((h - GROUND_H) / FLOOR_H));
  const fh = (h - GROUND_H) / floors;

  let win = "";
  let bit = 0;
  const nextBit = () => (seed >> (bit++ % 30)) & 1;
  for (let f = 0; f < floors; f++) {
    const v = GROUND_H + f * fh + (fh - 15) / 2;
    // front wall: two columns, no flower boxes (the door side stays plain)
    [[9, 24], [34, 49]].forEach(([u1, u2]) => {
      win += `<polygon class="emp-win ${nextBit() ? "lit" : ""}" points="${wallQuad(x, y, 1, u1, u2, v, v + 15)}"/>`;
    });
    // side wall: two columns, some with flower boxes
    [[7, 18], [22, 33]].forEach(([u1, u2]) => {
      win += `<polygon class="emp-win ${nextBit() ? "lit" : ""}" points="${wallQuad(x, y, -1, u1, u2, v, v + 15)}"/>`;
      if (nextBit()) win += flowerBox(x, y, -1, u1, u2, v);
    });
  }

  // The name goes on a plate at the kerb rather than on the building: a 58px
  // shopfront cannot hold readable text, and a street where you have to tap
  // every door to find out who lives there is not much of a street. The plate
  // is white in both themes — it is the one element here that has to stay
  // legible against a midday sky and a midnight one without being restyled.
  const name = p.business_name || "Client";
  const short = name.length > 14 ? name.slice(0, 13).trimEnd() + "…" : name;
  const cx = x + (FRONT_W - SIDE_W) / 2;
  const pw = Math.max(48, 15 + short.length * 5.8);

  const topMost = roofY - (FRONT_W + SIDE_W) * ISO;

  return `
    <g class="emp-building ${hue === null ? "no-niche" : ""}" data-id="${esc(p.id)}"
       ${hue === null ? "" : `style="--niche-hue:${hue};"`} tabindex="0" role="button"
       aria-label="${esc(name)}">
      <polygon class="emp-cast" points="${diamond(x + 6, y + 2, FRONT_W, SIDE_W)}"/>
      <g class="emp-body">
        <polygon class="emp-face-side" points="${wallQuad(x, y, -1, 0, SIDE_W, 0, wallTop)}"/>
        <polygon class="emp-face-front" points="${wallQuad(x, y, 1, 0, FRONT_W, 0, wallTop)}"/>
        <polygon class="emp-parapet" points="${wallQuad(x, y, -1, 0, SIDE_W, h, wallTop)}"/>
        <polygon class="emp-parapet" points="${wallQuad(x, y, 1, 0, FRONT_W, h, wallTop)}"/>
        ${win}
        <polygon class="emp-shop" points="${wallQuad(x, y, 1, 7, 18, 7, 25)}"/>
        <polygon class="emp-door" points="${wallQuad(x, y, 1, 24, 38, 0, 26)}"/>
        <circle class="emp-handle" cx="${n1(wallPt(x, y, 1, 36, 13)[0])}" cy="${n1(wallPt(x, y, 1, 36, 13)[1])}" r="1.3"/>
        <polygon class="emp-rim" points="${diamond(x, roofY, FRONT_W, SIDE_W)}"/>
        <polygon class="emp-deck" points="${diamond(x, roofY - 1, FRONT_W - 8, SIDE_W - 8)}"/>
      </g>
      <g class="emp-label">
        <rect x="${n1(cx - pw / 2)}" y="${PILL_Y}" width="${n1(pw)}" height="20" rx="10"/>
        <text x="${n1(cx)}" y="${PILL_Y + 13.6}" text-anchor="middle">${esc(short)}</text>
      </g>
      <rect class="emp-hit" x="${n1(x - SIDE_W - 6)}" y="${n1(topMost - 4)}"
            width="${SLOT_W + 12}" height="${n1(PILL_Y + 20 - topMost + 4)}" fill="transparent"/>
    </g>`;
}

// ---- street furniture ----------------------------------------------------
// Each of these takes the point on the slab where the thing stands, so they
// can be dropped anywhere without knowing what is next to them. They are
// placed on a fixed rhythm rather than at random, so nothing ever lands on
// top of a building, and the same street draws the same way every time.

function tree(x, y, seed) {
  const s = 0.85 + (seed % 4) * 0.09;
  const r = 13 * s;
  const th = 17 * s;
  return `<g class="emp-tree">
    <ellipse class="emp-cast" cx="${n1(x + 2)}" cy="${n1(y + 1)}" rx="${n1(r * 0.85)}" ry="${n1(r * 0.3)}"/>
    <rect class="emp-trunk" x="${n1(x - 2)}" y="${n1(y - th)}" width="4" height="${n1(th)}" rx="2"/>
    <circle class="emp-leaf-a" cx="${n1(x)}" cy="${n1(y - th - r * 0.5)}" r="${n1(r)}"/>
    <circle class="emp-leaf-a" cx="${n1(x - r * 0.64)}" cy="${n1(y - th - r * 0.05)}" r="${n1(r * 0.64)}"/>
    <circle class="emp-leaf-a" cx="${n1(x + r * 0.64)}" cy="${n1(y - th - r * 0.05)}" r="${n1(r * 0.64)}"/>
    <circle class="emp-leaf-b" cx="${n1(x - r * 0.3)}" cy="${n1(y - th - r * 0.82)}" r="${n1(r * 0.5)}"/>
  </g>`;
}

// The lamp's glow is a real radial gradient rather than a flat blob, and it is
// tagged emp-night so it only exists after dark — a pool of light on a sunlit
// pavement is the single fastest way to make a drawing look wrong.
function lamp(x, y) {
  return `<g class="emp-lamp">
    <circle class="emp-glow emp-night" cx="${n1(x)}" cy="${n1(y - 36)}" r="30"/>
    <ellipse class="emp-cast" cx="${n1(x + 1)}" cy="${n1(y)}" rx="5" ry="2"/>
    <rect class="emp-post" x="${n1(x - 1.6)}" y="${n1(y - 38)}" width="3.2" height="38" rx="1.6"/>
    <rect class="emp-post" x="${n1(x - 4)}" y="${n1(y - 3)}" width="8" height="3.4" rx="1.6"/>
    <path class="emp-lantern" d="M${n1(x - 4.6)} ${n1(y - 37)} L${n1(x - 3)} ${n1(y - 45)} h6 L${n1(x + 4.6)} ${n1(y - 37)} Z"/>
    <circle class="emp-post" cx="${n1(x)}" cy="${n1(y - 46.6)}" r="1.7"/>
  </g>`;
}

function bench(x, y) {
  const w = 24;
  const p = (u, v) => pt(x - w / 2 + u, y - u * ISO * 0.5 - v);
  const slat = (v1, v2, inset) => `<polygon class="emp-bench-wood" points="${p(inset, v1)} ${p(w - inset, v1)} ${p(w - inset, v2)} ${p(inset, v2)}"/>`;
  const leg = (u) => `<polygon class="emp-bench-leg" points="${p(u, 0)} ${p(u + 2.4, 0)} ${p(u + 2.4, 5.5)} ${p(u, 5.5)}"/>`;
  return `<g class="emp-bench">
    <ellipse class="emp-cast" cx="${n1(x + 1)}" cy="${n1(y)}" rx="13" ry="2.6"/>
    ${leg(1.6)}${leg(w - 4)}
    ${slat(5.5, 8.5, 0)}
    ${slat(10, 12.4, 1.5)}
    ${slat(13.4, 15.8, 1.5)}
  </g>`;
}

function planter(x, y) {
  return `<g class="emp-planter">
    <ellipse class="emp-cast" cx="${n1(x + 1)}" cy="${n1(y)}" rx="7" ry="2.4"/>
    <polygon class="emp-box-pot" points="${pt(x - 6, y - 10)} ${pt(x + 6, y - 10)} ${pt(x + 4.6, y)} ${pt(x - 4.6, y)}"/>
    <circle class="emp-leaf-a" cx="${n1(x)}" cy="${n1(y - 15)}" r="5.6"/>
    <circle class="emp-leaf-b" cx="${n1(x - 3.6)}" cy="${n1(y - 11.6)}" r="3.8"/>
    <circle class="emp-leaf-a" cx="${n1(x + 4)}" cy="${n1(y - 12)}" r="4"/>
  </g>`;
}

function postbox(x, y) {
  return `<g class="emp-postbox">
    <ellipse class="emp-cast" cx="${n1(x + 1)}" cy="${n1(y)}" rx="7" ry="2.4"/>
    <rect class="emp-pb-body" x="${n1(x - 6)}" y="${n1(y - 27)}" width="12" height="27" rx="5.6"/>
    <rect class="emp-pb-slot" x="${n1(x - 3.6)}" y="${n1(y - 21)}" width="7.2" height="2.4" rx="1.2"/>
    <rect class="emp-pb-band" x="${n1(x - 6)}" y="${n1(y - 9)}" width="12" height="2.6"/>
  </g>`;
}

function bike(x, y) {
  return `<g class="emp-bike">
    <ellipse class="emp-cast" cx="${n1(x + 1)}" cy="${n1(y)}" rx="12" ry="2.4"/>
    <circle class="emp-wheel" cx="${n1(x - 8)}" cy="${n1(y - 7.5)}" r="7"/>
    <circle class="emp-wheel" cx="${n1(x + 8)}" cy="${n1(y - 7.5)}" r="7"/>
    <path class="emp-frame" d="M${n1(x - 8)} ${n1(y - 7.5)} L${n1(x - 1)} ${n1(y - 7.5)} L${n1(x + 3)} ${n1(y - 16)} L${n1(x + 8)} ${n1(y - 7.5)} L${n1(x - 1)} ${n1(y - 7.5)}
       M${n1(x + 3)} ${n1(y - 16)} L${n1(x + 7.5)} ${n1(y - 16)}
       M${n1(x - 8)} ${n1(y - 7.5)} L${n1(x - 5)} ${n1(y - 17)} L${n1(x - 0.5)} ${n1(y - 17)}"/>
  </g>`;
}

// The market stall is the one piece of scenery with any real detail, because
// every street in Harare has one and it is what makes this read as a street
// here rather than a generic town from a stock illustration.
function cart(x, y) {
  let awning = "";
  for (let i = 0; i < 6; i++) {
    awning += `<polygon class="emp-awn-${i % 2}" points="${pt(x - 24 + i * 8, y - 44)} ${pt(x - 16 + i * 8, y - 44)} ${pt(x - 16 + i * 8, y - 36)} ${pt(x - 24 + i * 8, y - 36)}"/>`;
  }
  let produce = "";
  for (let i = 0; i < 5; i++) {
    produce += `<circle class="emp-produce-${i % 2}" cx="${n1(x - 15 + i * 7.5)}" cy="${n1(y - 27 - (i % 2) * 2)}" r="3.2"/>`;
  }
  return `<g class="emp-cart">
    <ellipse class="emp-cast" cx="${n1(x + 1)}" cy="${n1(y)}" rx="25" ry="3"/>
    <rect class="emp-cart-post" x="${n1(x - 22)}" y="${n1(y - 44)}" width="2.6" height="20"/>
    <rect class="emp-cart-post" x="${n1(x + 19.4)}" y="${n1(y - 44)}" width="2.6" height="20"/>
    ${awning}
    <polygon class="emp-cart-body" points="${pt(x - 23, y - 24)} ${pt(x + 23, y - 24)} ${pt(x + 20, y - 7)} ${pt(x - 20, y - 7)}"/>
    ${produce}
    <circle class="emp-wheel" cx="${n1(x - 13)}" cy="${n1(y - 5)}" r="5"/>
    <circle class="emp-wheel" cx="${n1(x + 13)}" cy="${n1(y - 5)}" r="5"/>
  </g>`;
}

// ---- sky -----------------------------------------------------------------
// Both skies are always drawn and CSS hides one, rather than JS reading the
// current theme. That is not laziness — it means flipping the theme switch
// re-skins the town instantly with no re-render, and it removes the whole
// class of bug where the town is left showing stars at midday because it was
// drawn before the theme was applied.

function starsSVG(w) {
  const n = Math.max(20, Math.round(w / 32));
  let s = "";
  for (let i = 0; i < n; i++) {
    const h = hashOf("star" + i);
    const sx = ((h % 1000) / 1000) * w;
    const sy = 8 + (((h >> 10) % 1000) / 1000) * 200;
    const r = 0.7 + ((h >> 4) % 3) * 0.45;
    s += `<circle cx="${n1(sx)}" cy="${n1(sy)}" r="${n1(r)}"/>`;
  }
  return `<g class="emp-stars emp-night">${s}</g>`;
}

// Drawn as a full disc with a second disc masked out of it, rather than as a
// hand-built arc path. Two circles are impossible to get wrong; a crescent
// written as two elliptical arcs depends on the sweep flags and silently
// renders as a lens or a full moon if either is off by one.
function moonSVG(w) {
  const cx = Math.min(w * 0.3, 160);
  const cy = 54;
  const r = 15;
  // The halo has to be a radial gradient, not a translucent disc. A flat
  // circle at low alpha still has a hard edge, and on a dark sky that edge is
  // the only thing you see — it reads as a grey plate with a moon on it.
  return `<g class="emp-moon emp-night">
    <circle class="emp-moon-halo" cx="${n1(cx)}" cy="${cy}" r="${n1(r * 3)}"/>
    <circle class="emp-moon-body" cx="${n1(cx)}" cy="${cy}" r="${r}" mask="url(#emp-moon-mask)"/>
  </g>`;
}

function moonMask(w) {
  const cx = Math.min(w * 0.3, 160);
  return `<mask id="emp-moon-mask">
    <circle cx="${n1(cx)}" cy="54" r="15" fill="#fff"/>
    <circle cx="${n1(cx + 8.5)}" cy="48.5" r="13.6" fill="#000"/>
  </mask>`;
}

function birdsSVG(w) {
  const spots = [[0.2, 62], [0.26, 46], [0.31, 70], [0.66, 54]];
  return `<g class="emp-birds emp-day">${spots
    .map(([f, by], i) => {
      const bx = Math.max(30, Math.min(w * f, w - 40));
      const s = 1 - i * 0.13;
      return `<path d="M${n1(bx - 7 * s)} ${n1(by)} q${n1(3.5 * s)} ${n1(-4 * s)} ${n1(7 * s)} 0 q${n1(3.5 * s)} ${n1(-4 * s)} ${n1(7 * s)} 0"/>`;
    })
    .join("")}</g>`;
}

// ---- people --------------------------------------------------------------
// One figure per teammate, spread across the whole street rather than bunched
// at one end so the town looks inhabited at any width. Skin tone, clothing
// colour and which way they face all come from the teammate's own id, so a
// person is recognisably the same person every time the street is drawn.
const SKIN = ["#4a2f1f", "#6b4227", "#8f5f36", "#b98450", "#dcae7e"];

function personSVG(prof, x) {
  const s = hashOf(prof.id);
  const hue = (s % 12) * 30;
  const skin = SKIN[(s >> 3) % SKIN.length];
  const flip = (s >> 6) % 2 ? -1 : 1;
  const k = 0.82 + ((s >> 9) % 4) * 0.06;
  return `<g class="emp-person" transform="translate(${n1(x)} ${PERSON_Y}) scale(${n1(flip * k)} ${n1(k)})">
    <ellipse class="emp-cast" cx="0" cy="0.5" rx="7.5" ry="2.4"/>
    <rect x="-3.4" y="-9" width="2.9" height="9" rx="1.4" fill="hsl(${hue} 30% 25%)"/>
    <rect x="0.5" y="-9" width="2.9" height="9" rx="1.4" fill="hsl(${hue} 30% 25%)"/>
    <rect x="-6.6" y="-21" width="2.6" height="10.5" rx="1.3" fill="hsl(${hue} 46% 45%)"/>
    <rect x="4" y="-21" width="2.6" height="10.5" rx="1.3" fill="hsl(${hue} 46% 45%)"/>
    <rect x="-5" y="-22" width="10" height="13.6" rx="4" fill="hsl(${hue} 50% 53%)"/>
    <circle cx="0" cy="-26.6" r="5" fill="${skin}"/>
    <path d="M-5 -28.4a5 5 0 0 1 10 0c-1.7-1.6-8.3-1.6-10 0Z" fill="#231a13"/>
    <title>${esc(prof.full_name || "Teammate")}</title>
  </g>`;
}

// ---- assembly ------------------------------------------------------------

const BACK_ITEMS = [tree, lamp, tree, tree, lamp, tree];
const FRONT_ITEMS = [bench, planter, bike, bench, postbox, planter];
const BACK_Y = BASE_Y - 6;    // trees and lamps stand behind the building line
const FRONT_Y = BASE_Y + 14;  // benches and bikes stand in front of it

function skyDefs(w) {
  return `<defs>
    <linearGradient id="emp-sky-grad" x1="0" y1="0" x2="0" y2="1">
      <stop class="emp-sky-a" offset="0"/>
      <stop class="emp-sky-b" offset="1"/>
    </linearGradient>
    <radialGradient id="emp-glow-grad">
      <stop class="emp-glow-a" offset="0"/>
      <stop class="emp-glow-b" offset="1"/>
    </radialGradient>
    <radialGradient id="emp-moon-grad">
      <stop class="emp-moonglow-a" offset="0.34"/>
      <stop class="emp-moonglow-b" offset="1"/>
    </radialGradient>
    ${moonMask(w)}
  </defs>`;
}

function skySVG(w, h) {
  return `<rect class="emp-sky" x="0" y="0" width="${w}" height="${h}"/>
    ${starsSVG(w)}${moonSVG(w)}${birdsSVG(w)}`;
}

function slabSVG(x0, w, backY, frontY, botY, bev) {
  return `
    <polygon class="emp-slab-face" points="${pt(x0, frontY)} ${pt(x0 + w, frontY)} ${pt(x0 + w - 8, botY)} ${pt(x0 + 8, botY)}"/>
    <polygon class="emp-slab-top" points="${pt(x0 + bev, backY)} ${pt(x0 + w - bev, backY)} ${pt(x0 + w, frontY)} ${pt(x0, frontY)}"/>`;
}

export function renderEmpire() {
  const root = document.getElementById("view-empire");
  root.innerHTML = "";

  const clients = townClients();
  const totalMRR = clients.reduce((s, p) => s + (Number(p.mrr) || 0), 0);
  const districts = new Set(clients.map((p) => p.niche_id).filter(Boolean)).size;
  const orgName = store.organization?.name || "Your Agency";

  const wrap = el(`
    <div>
      <div class="page-title mt-0">Empire<span class="accent">.</span></div>
      <p class="text-faint" style="font-size:12.5px;margin-top:-6px;margin-bottom:14px;">
        ${esc(orgName)}, one building for every client the team has signed. It grows when you do.
      </p>

      <div class="stat-grid cols-3" id="emp-stats" style="margin-bottom:14px;">
        <div class="stat-card"><div class="num">${clients.length}</div><div class="label">Buildings</div></div>
        <div class="stat-card purple"><div class="num">${money(totalMRR)}</div><div class="label">Per Month</div></div>
        <div class="stat-card"><div class="num">${districts}</div><div class="label">Districts</div></div>
      </div>

      <div class="card emp-card" style="padding:0;overflow:hidden;">
        <div class="emp-scroll" id="emp-scroll"></div>
      </div>

      <div id="emp-detail"></div>

      <div class="section-title">How the town grows</div>
      <div class="card emp-foot">
        <div>
          <div class="emp-foot-title">Every building here started as a mission.</div>
          <div class="text-faint" style="font-size:11.5px;">Work your missions, sign the client, and the street gets longer. Nothing else puts a building up.</div>
        </div>
        <button class="btn btn-ghost" id="emp-go-missions">Go to Missions</button>
      </div>
    </div>
  `);
  root.appendChild(wrap);

  renderStreet(wrap.querySelector("#emp-scroll"), clients, wrap.querySelector("#emp-detail"));

  // Dynamic import rather than a top-level one: main.js imports this view, so
  // importing switchView statically would close a cycle. Same shape as the
  // dashboard's goToPipelineStatus.
  wrap.querySelector("#emp-go-missions").addEventListener("click", async () => {
    const { switchView } = await import("../main.js");
    switchView("tasks");
  });
}

function emptyStreet(host) {
  // An empty town has to explain itself, or it just looks broken. This is also
  // the honest state for a new agency — the street is empty because nobody has
  // signed anyone yet, not because the feature is failing. Same sky and same
  // slab as the real street, so it reads as this street before anyone built on
  // it rather than as a different illustration. The dashed box is a
  // building-shaped hole, drawn in the same isometric as the real thing: it
  // shows exactly where the first client will land, down to the roofline.
  const W = 420;
  const bx = 232;
  const by = 168;
  const gh = 76;
  const ghost = [
    diamond(bx, by, FRONT_W, SIDE_W),
    diamond(bx, by - gh, FRONT_W, SIDE_W),
  ]
    .map((pts) => `<polygon points="${pts}"/>`)
    .join("");
  const edges = [
    [bx, by, bx, by - gh],
    [bx + FRONT_W, by - FRONT_W * ISO, bx + FRONT_W, by - FRONT_W * ISO - gh],
    [bx - SIDE_W, by - SIDE_W * ISO, bx - SIDE_W, by - SIDE_W * ISO - gh],
  ]
    .map(([x1, y1, x2, y2]) => `<path d="M${n1(x1)} ${n1(y1)} L${n1(x2)} ${n1(y2)}"/>`)
    .join("");

  host.innerHTML = `
    <div class="emp-empty">
      <svg viewBox="0 0 ${W} 230" class="emp-empty-svg" role="img"
           aria-label="An empty plot of land where your first client's building will go">
        ${skyDefs(W)}
        ${skySVG(W, 230)}
        ${slabSVG(44, 332, 138, 186, 198, 44)}
        ${tree(110, 178, 1)}
        ${lamp(346, 172)}
        <g class="emp-plot">${ghost}${edges}</g>
      </svg>
      <div class="emp-empty-title">Empty land, for now</div>
      <div class="emp-empty-sub">Sign your first client and the first building goes up right here. Every one after that makes the street longer.</div>
    </div>`;
}

function renderStreet(host, clients, detailHost) {
  if (!clients.length) return emptyStreet(host);

  // Height is the client's share of the biggest client, floored well above
  // zero so a small client still gets a building someone would be proud of
  // rather than a doorstep. The scale is relative on purpose: it says "how do
  // my clients compare" and never exposes one client's actual fee to whoever
  // happens to be looking at the street.
  const maxMRR = Math.max(...clients.map((p) => Number(p.mrr) || 0), 0);
  const heightFor = (p) => {
    if (maxMRR <= 0) return 118;
    return Math.round(MIN_H + ((Number(p.mrr) || 0) / maxMRR) * (MAX_H - MIN_H));
  };

  // The slab is exactly as long as the town and is centred in whatever width
  // the card happens to be. Stretching it to fill instead would give a
  // three-client agency a vast empty pavement with three buildings huddled at
  // one end; an island that is simply small says the same true thing without
  // looking like a rendering fault.
  const naturalW = PAD_X * 2 + (clients.length - 1) * PITCH + SLOT_W;
  const streetW = Math.max(naturalW, Math.floor(host.clientWidth) || 0);
  const ox = Math.max(0, Math.round((streetW - naturalW) / 2));
  const nearX = (i) => ox + PAD_X + SIDE_W + i * PITCH;

  let buildings = "";
  let backScenery = "";
  let frontScenery = "";

  clients.forEach((p, i) => {
    buildings += buildingSVG(p, nearX(i), heightFor(p), nicheHue(p.niche_id));
    if (i >= clients.length - 1) return;
    const gapCx = nearX(i) + FRONT_W + GAP / 2;
    if (i % 4 === 2) {
      // the market stall takes a whole gap to itself
      frontScenery += cart(gapCx, FRONT_Y);
    } else {
      backScenery += BACK_ITEMS[i % BACK_ITEMS.length](gapCx - 9, BACK_Y, hashOf(p.id));
      frontScenery += FRONT_ITEMS[i % FRONT_ITEMS.length](gapCx + 12, FRONT_Y);
    }
  });

  // Both ends get something too, so the street starts and stops at a lamp
  // rather than at a hard edge of nothing.
  backScenery += lamp(ox + PAD_X - 28, BACK_Y);
  backScenery += tree(ox + naturalW - PAD_X + 26, BACK_Y, 2);
  frontScenery += postbox(ox + naturalW - PAD_X + 6, FRONT_Y);

  const people = store.profiles.slice(0, 8);
  const span = Math.max(1, naturalW - PAD_X * 2 - 40);
  const peopleSVG = people
    .map((prof, i) => personSVG(prof, ox + PAD_X + 20 + (span / people.length) * (i + 0.5)))
    .join("");

  host.innerHTML = `
    <svg class="emp-svg" width="${streetW}" height="${TOTAL_H}"
         viewBox="0 0 ${streetW} ${TOTAL_H}" role="img"
         aria-label="A street with one building for each of your ${clients.length} signed clients">
      ${skyDefs(streetW)}
      ${skySVG(streetW, TOTAL_H)}
      ${slabSVG(ox, naturalW, SLAB_BACK_Y, SLAB_FRONT_Y, SLAB_BOT_Y, SLAB_BEV)}
      ${backScenery}
      ${buildings}
      ${frontScenery}
      ${peopleSVG}
    </svg>`;

  const svg = host.querySelector("svg");
  svg.querySelectorAll(".emp-building").forEach((g) => {
    const show = () => showClient(detailHost, g.dataset.id);
    g.addEventListener("click", show);
    g.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); show(); }
    });
  });

  // Open on the newest end of the street: on a long street the left edge is
  // all old news and the most recent win is what you want to see. But only
  // once there's real overflow — when the street only just misses fitting,
  // jumping to the end lops a sliver off the first building and reads as a
  // rendering fault rather than as something you're meant to scroll.
  requestAnimationFrame(() => {
    if (host.scrollWidth - host.clientWidth > 90) host.scrollLeft = host.scrollWidth;
  });

  // The street's width is baked in at draw time (see streetW above), so it has
  // to be redrawn when the card changes size — collapsing the sidebar or
  // rotating a phone would otherwise leave the island off-centre. Only redraws
  // when the width actually changed, so this can't loop.
  if (host._empRO) host._empRO.disconnect();
  let lastW = Math.floor(host.clientWidth);
  host._empRO = new ResizeObserver(() => {
    const w = Math.floor(host.clientWidth);
    if (w !== lastW && w > 0) { lastW = w; renderStreet(host, clients, detailHost); }
  });
  host._empRO.observe(host);
}

function showClient(host, id) {
  const p = store.prospects.find((x) => x.id === id);
  if (!p) return;
  const niche = nicheById(p.niche_id);
  const signer = p.assigned_to ? profileById(p.assigned_to) : null;
  const hue = nicheHue(p.niche_id);

  host.innerHTML = "";
  const card = el(`
    <div class="card emp-detail">
      <div class="flex-between" style="align-items:flex-start;">
        <div>
          <div class="emp-detail-name">
            ${hue === null ? "" : `<span class="niche-dot" style="--niche-hue:${hue};"></span>`}${esc(p.business_name || "Client")}
          </div>
          <div class="text-faint" style="font-size:11.5px;">
            ${niche ? esc(niche.name) + " district" : "No district"}${p.city ? " · " + esc(p.city) : ""}
          </div>
        </div>
        <span class="small-link" id="emp-open">Open client</span>
      </div>
      <div class="emp-detail-rows">
        <div><span class="text-faint">Worth</span><b>${p.mrr ? money(Number(p.mrr)) + "/mo" : "Not set"}</b></div>
        <div><span class="text-faint">Signed by</span><b>${signer ? esc(signer.full_name || "Teammate") : "Unassigned"}</b></div>
        <div><span class="text-faint">On the street since</span><b>${p.created_at ? esc(fmtDate(p.created_at)) : "—"}</b></div>
      </div>
    </div>
  `);
  // openProspectDetail takes the prospect object, not its id — it re-reads the
  // live copy out of the store itself and only falls back to what it was given.
  card.querySelector("#emp-open").addEventListener("click", () => openProspectDetail(p));
  host.appendChild(card);
  card.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

export function initEmpireView() {
  const rerender = () => {
    if (document.getElementById("view-empire")?.classList.contains("active")) renderEmpire();
  };
  on("prospects", rerender);
  on("niches", rerender);
  on("profiles", rerender);
}
