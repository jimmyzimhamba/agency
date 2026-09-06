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

const GROUND_Y = 300;   // where every building's foot sits
const LABEL_Y = 315;    // client name, on the verge
const ROAD_Y = 324;     // tarmac starts
const PERSON_Y = 356;   // teammates stand on the road
const TOTAL_H = 380;
const BUILD_W = 66;
const GAP = 12;
const PAD_X = 34;
const MIN_H = 76;
const MAX_H = 196;

// Stable per-client pseudo-randomness. Roof shape, window pattern and the
// little bits of scenery all key off this, so a given client always gets the
// same building — a town that reshuffled itself on every render would read as
// broken rather than alive.
function hashOf(str) {
  let h = 2166136261;
  for (let i = 0; i < String(str).length; i++) {
    h ^= String(str).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

// Signed clients, oldest first, so the street reads left-to-right as the
// agency's history — the founding client is nearest the town sign.
function townClients() {
  return store.prospects
    .filter((p) => p.status === "signed")
    .slice()
    .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
}

function buildingSVG(p, x, h, hue) {
  const seed = hashOf(p.id);
  const y = GROUND_Y - h;
  // Colour comes from the niche's hue through the same oklch() ramp the niche
  // dots use, so a building is literally the same colour as its niche's dot
  // elsewhere in the app. Worth being careful here: NICHE_HUES are *OKLCH*
  // hue angles, not HSL ones. Feeding them to hsl() looks plausible and is
  // wrong — 130 and 155 are two clearly different greens in OKLCH and nearly
  // the same green in HSL, so two niches would have come out identical.
  // A client with no niche set gets a neutral rather than an invented colour.
  const roofStyle = seed % 3;

  let roof = "";
  if (roofStyle === 0) {
    // flat with a parapet lip
    roof = `<rect class="emp-roof" x="${x - 4}" y="${y - 7}" width="${BUILD_W + 8}" height="7" rx="2"/>`;
  } else if (roofStyle === 1) {
    // pitched
    roof = `<path class="emp-roof" d="M${x - 6} ${y} L${x + BUILD_W / 2} ${y - 20} L${x + BUILD_W + 6} ${y} Z"/>`;
  } else {
    // stepped
    roof = `<rect class="emp-roof" x="${x - 3}" y="${y - 6}" width="${BUILD_W + 6}" height="6" rx="1.5"/>
            <rect class="emp-roof" x="${x + 12}" y="${y - 13}" width="${BUILD_W - 24}" height="8" rx="1.5"/>`;
  }

  // Windows fill the wall above the door. Lit ones are the same warm gold the
  // app already uses for money, which is a nice accident: a taller building
  // with more lit windows is literally a bigger client.
  const cols = 3;
  const rows = Math.max(1, Math.floor((h - 44) / 26));
  let windows = "";
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const lit = (seed >> (r * cols + c)) & 1;
      const wx = x + 9 + c * 17;
      const wy = y + 14 + r * 26;
      windows += `<rect class="emp-win ${lit ? "lit" : ""}" x="${wx}" y="${wy}" width="11" height="14" rx="1.5"/>`;
    }
  }

  const doorX = x + BUILD_W / 2 - 8;
  // The name goes under the building rather than on it: a 66px shopfront can't
  // hold readable text, and a street where you have to tap every door to find
  // out who lives there isn't much of a street. Long names are cut with an
  // ellipsis — the full one is in the detail card and the accessible label.
  const name = p.business_name || "Client";
  const short = name.length > 13 ? name.slice(0, 12).trimEnd() + "…" : name;
  return `
    <g class="emp-building ${hue === null ? "no-niche" : ""}" data-id="${esc(p.id)}"
       ${hue === null ? "" : `style="--niche-hue:${hue};"`} tabindex="0" role="button"
       aria-label="${esc(name)}">
      <rect class="emp-wall" x="${x}" y="${y}" width="${BUILD_W}" height="${h}" rx="3"/>
      ${roof}
      ${windows}
      <rect class="emp-roof" x="${doorX}" y="${GROUND_Y - 26}" width="16" height="26" rx="2"/>
      <circle cx="${doorX + 12}" cy="${GROUND_Y - 13}" r="1.4" fill="rgba(255,255,255,0.75)"/>
      <text class="emp-name" x="${x + BUILD_W / 2}" y="${LABEL_Y}" text-anchor="middle">${esc(short)}</text>
      <rect class="emp-hit" x="${x - 6}" y="${y - 22}" width="${BUILD_W + 12}" height="${h + 24}" fill="transparent"/>
    </g>`;
}

// Scenery exists so the street doesn't read as a bar chart. Trees and lamps
// sit in the gaps between buildings on a fixed rhythm rather than at random,
// so they never land on top of a building.
function scenerySVG(i, x) {
  if (i % 4 === 2) {
    return `<g class="emp-tree">
      <rect x="${x + 2}" y="${GROUND_Y - 16}" width="4" height="16" rx="1.5"/>
      <circle cx="${x + 4}" cy="${GROUND_Y - 24}" r="11"/>
      <circle cx="${x - 3}" cy="${GROUND_Y - 19}" r="7"/>
      <circle cx="${x + 11}" cy="${GROUND_Y - 19}" r="7"/>
    </g>`;
  }
  if (i % 4 === 0) {
    return `<g class="emp-lamp">
      <rect x="${x + 3}" y="${GROUND_Y - 34}" width="3" height="34" rx="1.5"/>
      <circle cx="${x + 4.5}" cy="${GROUND_Y - 37}" r="4.5"/>
    </g>`;
  }
  return "";
}

// One figure per teammate, standing on the pavement. They're spread across
// the whole street rather than bunched at one end so the town looks inhabited
// at any width.
function peopleSVG(profiles, streetW) {
  if (!profiles.length) return "";
  const span = Math.max(1, streetW - PAD_X * 2 - 40);
  return profiles
    .map((prof, i) => {
      const x = PAD_X + 20 + (span / Math.max(1, profiles.length)) * (i + 0.5);
      const hue = (hashOf(prof.id) % 12) * 30;
      const flip = hashOf(prof.id) % 2 ? -1 : 1;
      return `<g class="emp-person" transform="translate(${x.toFixed(1)} ${PERSON_Y}) scale(${flip} 1)">
        <ellipse class="emp-shadow" cx="0" cy="1" rx="7" ry="2.2"/>
        <rect x="-4.5" y="-13" width="9" height="11" rx="3" fill="hsl(${hue} 52% 55%)"/>
        <circle cx="0" cy="-17" r="4.6" fill="hsl(32 46% 74%)"/>
        <path d="M-4.6 -18.6a4.6 4.6 0 0 1 9.2 0Z" fill="hsl(${hue} 38% 26%)"/>
        <rect x="-3.6" y="-2.4" width="2.8" height="3.2" rx="1" fill="hsl(${hue} 38% 32%)"/>
        <rect x="0.8" y="-2.4" width="2.8" height="3.2" rx="1" fill="hsl(${hue} 38% 32%)"/>
        <title>${esc(prof.full_name || "Teammate")}</title>
      </g>`;
    })
    .join("");
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

function renderStreet(host, clients, detailHost) {
  if (!clients.length) {
    // An empty town has to explain itself, or it just looks broken. This is
    // also the honest state for a new agency — the street is empty because
    // nobody's signed anyone yet, not because the feature isn't working.
    // The same sky, grass and road as the real street, so the empty state
    // reads as this street before anyone built on it rather than as a
    // different illustration. The dashed outline is a building-shaped hole:
    // it shows exactly where the first client will land.
    host.innerHTML = `
      <div class="emp-empty">
        <svg viewBox="0 0 420 210" class="emp-empty-svg" role="img"
             aria-label="An empty plot of land where your first client's building will go">
          <defs>
            <linearGradient id="emp-sky-grad" x1="0" y1="0" x2="0" y2="1">
              <stop class="emp-sky-a" offset="0"/>
              <stop class="emp-sky-b" offset="1"/>
            </linearGradient>
          </defs>
          <rect class="emp-sky" x="0" y="0" width="420" height="158"/>
          <circle class="emp-sun" cx="356" cy="40" r="18"/>
          <rect class="emp-ground" x="0" y="158" width="420" height="52"/>
          <rect class="emp-road" x="0" y="184" width="420" height="26"/>
          <path class="emp-road-line" d="M0 197 H420"/>
          <g class="emp-tree">
            <rect x="54" y="140" width="4" height="18" rx="1.5"/>
            <circle cx="56" cy="132" r="12"/>
            <circle cx="46" cy="138" r="7.5"/>
            <circle cx="66" cy="138" r="7.5"/>
          </g>
          <g class="emp-lamp">
            <rect x="348" y="126" width="3" height="32" rx="1.5"/>
            <circle cx="349.5" cy="123" r="4.5"/>
          </g>
          <g class="emp-plot">
            <path d="M170 158 v-52 h80 v52"/>
            <path d="M162 106 L210 84 L258 106"/>
          </g>
        </svg>
        <div class="emp-empty-title">Empty land, for now</div>
        <div class="emp-empty-sub">Sign your first client and the first building goes up right here. Every one after that makes the street longer.</div>
      </div>`;
    return;
  }

  // Height is the client's share of the biggest client, floored well above
  // zero so a small client still gets a building someone would be proud of
  // rather than a doorstep. The scale is relative on purpose: it says "how do
  // my clients compare" and never exposes one client's actual fee to whoever
  // happens to be looking at the street.
  const maxMRR = Math.max(...clients.map((p) => Number(p.mrr) || 0), 0);
  const heightFor = (p) => {
    if (maxMRR <= 0) return 118;
    const frac = (Number(p.mrr) || 0) / maxMRR;
    return Math.round(MIN_H + frac * (MAX_H - MIN_H));
  };

  // A short street still has to fill the card, or the sky stops mid-air and
  // the whole thing looks broken. Rather than stretching the drawing (which
  // would make a 3-client town's buildings comically bigger than a 30-client
  // town's), we keep the buildings a fixed size and just carry on the ground
  // and sky to the edge. The leftover space reads as land you haven't built
  // on yet, which is the right message anyway.
  const naturalW = PAD_X * 2 + clients.length * BUILD_W + (clients.length - 1) * GAP;
  const streetW = Math.max(naturalW, Math.floor(host.clientWidth) || 0);
  const people = store.profiles.slice(0, 8);

  let buildings = "";
  let scenery = "";
  clients.forEach((p, i) => {
    const x = PAD_X + i * (BUILD_W + GAP);
    buildings += buildingSVG(p, x, heightFor(p), nicheHue(p.niche_id));
    if (i < clients.length - 1) scenery += scenerySVG(i, x + BUILD_W + 1);
  });

  host.innerHTML = `
    <svg class="emp-svg" width="${streetW}" height="${TOTAL_H}"
         viewBox="0 0 ${streetW} ${TOTAL_H}" role="img"
         aria-label="A street with one building for each of your ${clients.length} signed clients">
      <defs>
        <linearGradient id="emp-sky-grad" x1="0" y1="0" x2="0" y2="1">
          <stop class="emp-sky-a" offset="0"/>
          <stop class="emp-sky-b" offset="1"/>
        </linearGradient>
      </defs>
      <rect class="emp-sky" x="0" y="0" width="${streetW}" height="${GROUND_Y}"/>
      <circle class="emp-sun" cx="${streetW - 46}" cy="46" r="20"/>
      <rect class="emp-ground" x="0" y="${GROUND_Y}" width="${streetW}" height="${TOTAL_H - GROUND_Y}"/>
      <rect class="emp-road" x="0" y="${ROAD_Y}" width="${streetW}" height="${TOTAL_H - ROAD_Y}"/>
      <path class="emp-road-line" d="M0 ${(ROAD_Y + TOTAL_H) / 2} H${streetW}"/>
      ${scenery}
      ${buildings}
      ${peopleSVG(people, naturalW)}
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
  // rotating a phone would otherwise leave a gap or a stray scrollbar. Only
  // redraws when the width actually changed, so this can't loop.
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
  card.querySelector("#emp-open").addEventListener("click", () => openProspectDetail(p.id));
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
