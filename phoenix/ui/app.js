/* app.js — wires the graph, panels, ask bar, reactor and voice together. */

const SILENCE_MS = 900;          // end-of-turn after this much quiet (tunable)
const SILENCE_LEVEL = 0.012;     // RMS below this counts as silence

const state = {
  graph: null,
  counts: {},
  hidden: new Set(),
  history: [],       // last ~10 turns [{role, content}]
  status: {},
  speaking: false,
  muted: false,
};

let G;               // PhoenixGraph instance
let reactor;         // reactor HUD controller
let voice;           // voice controller

// ---- boot ------------------------------------------------------------------
async function boot() {
  G = new PhoenixGraph(document.getElementById("graph"));
  G.onFocus((id) => renderInspector(id));

  reactor = makeReactor(document.getElementById("reactorCanvas"),
    document.getElementById("reactorState"));

  const [graph, status] = await Promise.all([
    fetch("/api/graph").then((r) => r.json()),
    fetch("/api/status").then((r) => r.json()).catch(() => ({})),
  ]);
  state.graph = graph;
  state.status = status;
  state.counts = status.counts || countTypes(graph.nodes);

  G.setData(graph);
  setTimeout(() => G.fit(), 350);

  document.getElementById("sourceBadge").textContent = graph.source || "DEMO";
  renderHubs();
  renderFilters();
  renderBadges();
  wireToolbar();
  wireDock();
  rotatePrompt();

  voice = makeVoice();
}

function countTypes(nodes) {
  const c = {};
  for (const n of nodes) c[n.type] = (c[n.type] || 0) + 1;
  return c;
}

// ---- inspector -------------------------------------------------------------
async function renderInspector(id) {
  const el = document.getElementById("inspectorBody");
  if (!id) {
    el.innerHTML = "Click a node to focus it. Shift-click a second to trace the path.";
    return;
  }
  const n = await fetch(`/api/node?id=${encodeURIComponent(id)}`).then((r) => r.json());
  if (n.error) return;
  const color = (window.TYPE_COLORS[n.type] || "#9b8bc0");
  const nbs = (n.neighbors || []).slice(0, 12).map((x) =>
    `<span class="nb" data-id="${escapeAttr(x)}">${escapeHtml(x)}</span>`).join("");
  el.innerHTML = `
    <div class="title"><span style="color:${color}">●</span>${escapeHtml(n.label)}
      <span class="type-chip">${escapeHtml(n.type)}</span></div>
    <div class="excerpt">${escapeHtml(n.excerpt || "")}</div>
    ${nbs ? `<div class="neighbors">${nbs}</div>` : ""}`;
  el.querySelectorAll(".nb").forEach((s) =>
    s.addEventListener("click", () => G.focusNode(s.dataset.id)));
}

// ---- hubs ------------------------------------------------------------------
function renderHubs() {
  const hubs = [...state.graph.nodes].sort((a, b) => b.degree - a.degree).slice(0, 8);
  const box = document.getElementById("hubList");
  box.innerHTML = hubs.map((n) => `
    <div class="hub-row" data-id="${escapeAttr(n.id)}">
      <span class="swatch" style="background:${window.TYPE_COLORS[n.type] || "#9b8bc0"}"></span>
      <span class="label">${escapeHtml(n.label)}</span>
      <span class="count">${n.degree}</span>
    </div>`).join("");
  box.querySelectorAll(".hub-row").forEach((r) =>
    r.addEventListener("click", () => G.focusNode(r.dataset.id)));
}

// ---- filters ---------------------------------------------------------------
function renderFilters() {
  const order = Object.entries(state.counts).sort((a, b) => b[1] - a[1]);
  const box = document.getElementById("filterList");
  box.innerHTML = order.map(([type, count]) => `
    <div class="filter-row" data-type="${escapeAttr(type)}">
      <span class="swatch" style="color:${window.TYPE_COLORS[type] || "#9b8bc0"};background:${window.TYPE_COLORS[type] || "#9b8bc0"}"></span>
      <span class="label">${escapeHtml(type)}</span>
      <span class="count">${count}</span>
    </div>`).join("");
  box.querySelectorAll(".filter-row").forEach((r) =>
    r.addEventListener("click", () => {
      const t = r.dataset.type;
      if (state.hidden.has(t)) { state.hidden.delete(t); r.classList.remove("off"); }
      else { state.hidden.add(t); r.classList.add("off"); }
      G.setHiddenTypes(state.hidden);
    }));
}

// ---- badges ----------------------------------------------------------------
function renderBadges() {
  const s = state.status;
  const box = document.getElementById("badges");
  const pills = [];
  pills.push(`<span class="badge-pill ${s.source === "LIVE" ? "warnpill" : ""}">${s.source || "DEMO"}</span>`);
  pills.push(s.model
    ? `<span class="badge-pill ok">model on</span>`
    : `<span class="badge-pill warnpill">model off · file-scored</span>`);
  pills.push(s.voice
    ? `<span class="badge-pill ok">voice ready</span>`
    : `<span class="badge-pill warnpill">voice off</span>`);
  box.innerHTML = pills.join("");
}

// ---- toolbar ---------------------------------------------------------------
function wireToolbar() {
  const fit = document.getElementById("btnFit");
  const labels = document.getElementById("btnLabels");
  const pulse = document.getElementById("btnPulse");
  fit.addEventListener("click", () => G.fit());
  labels.addEventListener("click", () => {
    labels.classList.toggle("on");
    G.setLabels(labels.classList.contains("on"));
  });
  pulse.addEventListener("click", () => {
    pulse.classList.toggle("on");
    G.setPulse(pulse.classList.contains("on"));
  });
}

// ---- dock / ask ------------------------------------------------------------
function wireDock() {
  document.getElementById("askForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const inp = document.getElementById("ask");
    const text = inp.value.trim();
    if (!text) return;
    inp.value = "";
    ask(text);
  });
  document.getElementById("btnBrief").addEventListener("click", () => ask("brief me"));
  document.getElementById("btnPlan").addEventListener("click", () => ask("plan my day"));
  document.getElementById("btnMem").addEventListener("click", () => ask("what do you remember?"));
  document.getElementById("btnMute").addEventListener("click", toggleMute);
  document.getElementById("btnMic").addEventListener("click", () => voice && voice.toggle());
  document.getElementById("btnWake").addEventListener("click", () => voice && voice.wakeToggle());

  document.addEventListener("keydown", (e) => {
    if (e.code === "Escape") { stopSpeaking(); }   // barge-in: interrupt speech, keep listening
    if (e.code === "Space" && document.activeElement.id !== "ask") {
      e.preventDefault(); voice && voice.toggle();
    }
  });
}

async function ask(text, spokenBack = true) {
  pushBubble("you", text, null, false);
  state.history.push({ role: "user", content: text });
  reactor.set("thinking");
  let res;
  try {
    res = await fetch("/api/ask", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, history: state.history.slice(-20) }),
    }).then((r) => r.json());
  } catch (err) {
    reactor.set("idle");
    pushBubble("phoenix", "Server unreachable.", null, false);
    return;
  }
  reactor.set("idle");
  state.history.push({ role: "assistant", content: res.spoken || "" });
  if (state.history.length > 40) state.history = state.history.slice(-40);

  pushBubble("phoenix", res.spoken || "", res.card, true);
  if (res.focus) G.focusNode(res.focus);

  if (spokenBack && res.spoken && !state.muted) speak(res.spoken);
}

// ---- speech out ------------------------------------------------------------
let currentAudio = null;
async function speak(text) {
  if (state.muted) return;
  try {
    reactor.set("speaking");
    state.speaking = true;
    if (voice) voice.deafen(true);           // mic goes deaf while we talk
    const resp = await fetch("/api/speak", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!resp.ok) throw new Error("tts " + resp.status);
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    currentAudio = new Audio(url);
    currentAudio.onended = () => { state.speaking = false; reactor.set("idle"); if (voice) voice.deafen(false); };
    await currentAudio.play();
  } catch (err) {
    state.speaking = false;
    reactor.set("idle");
    if (voice) voice.deafen(false);
    flashBadge("voice failed — " + err.message);
  }
}
function stopSpeaking() {
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  state.speaking = false;
  reactor.set("idle");
  if (voice) voice.deafen(false);
}
function toggleMute() {
  state.muted = !state.muted;
  document.getElementById("btnMute").classList.toggle("on", state.muted);
  if (state.muted) stopSpeaking();
}

// ---- bubbles ---------------------------------------------------------------
function pushBubble(who, text, card, spoken) {
  const stream = document.getElementById("stream");
  const b = document.createElement("div");
  b.className = "bubble" + (spoken ? " spoken" : "");
  let html = `<div class="who">${who}</div><div>${escapeHtml(text)}</div>`;
  if (card) html += renderCard(card);
  b.innerHTML = html;
  stream.appendChild(b);
  b.querySelectorAll(".cite").forEach((c) =>
    c.addEventListener("click", () => G.focusNode(c.dataset.id)));
  while (stream.children.length > 4) stream.removeChild(stream.firstChild);
}

function renderCard(card) {
  let h = `<div class="card">`;
  if (card.title) h += `<div style="font-weight:600;margin-bottom:6px">${escapeHtml(card.title)}</div>`;
  for (const row of card.rows || []) {
    h += `<div class="row"><span class="k">${escapeHtml(row.k)}</span><span>${escapeHtml(row.v)}</span></div>`;
  }
  for (const c of card.cites || []) {
    h += `<div class="cite" data-id="${escapeAttr(c)}">↳ ${escapeHtml(c)}</div>`;
  }
  if (card.warn) h += `<div class="warn">⚠ ${escapeHtml(card.warn)}</div>`;
  h += `</div>`;
  return h;
}

// ---- reactor HUD -----------------------------------------------------------
function makeReactor(canvas, label) {
  const ctx = canvas.getContext("2d");
  let mode = "idle", t = 0, level = 0;
  const COLORS = { idle: "#7c6bff", listening: "#35e6a6", thinking: "#ffbf5c", speaking: "#cf8bff" };
  function set(m) { mode = m; label.textContent = m; }
  function setLevel(v) { level = v; }
  function draw() {
    t += 0.03;
    ctx.clearRect(0, 0, 150, 150);
    const cx = 75, cy = 75;
    const color = COLORS[mode];
    const rings = 3;
    for (let i = 0; i < rings; i++) {
      const base = 26 + i * 12;
      const wobble = Math.sin(t * (1 + i * 0.4) + i) * (mode === "idle" ? 2 : 5);
      const boost = mode === "listening" ? level * 60 : (mode === "speaking" ? Math.abs(Math.sin(t * 6)) * 8 : 0);
      const r = base + wobble + boost;
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.15 + (rings - i) * 0.14;
      ctx.lineWidth = 1.5;
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    // core
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.shadowColor = color; ctx.shadowBlur = 20 + (mode === "speaking" ? Math.abs(Math.sin(t * 6)) * 14 : 0);
    ctx.arc(cx, cy, 9 + (mode === "listening" ? level * 20 : 0), 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    // ticks
    ctx.globalAlpha = 0.5;
    for (let a = 0; a < 60; a++) {
      const ang = (a / 60) * Math.PI * 2 + t * 0.2;
      const on = a % 5 === 0;
      const r1 = 60, r2 = on ? 68 : 64;
      ctx.beginPath();
      ctx.strokeStyle = color; ctx.globalAlpha = on ? 0.5 : 0.2;
      ctx.moveTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
      ctx.lineTo(cx + Math.cos(ang) * r2, cy + Math.sin(ang) * r2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(draw);
  }
  draw();
  return { set, setLevel };
}

// ---- rotating example prompt ----------------------------------------------
function rotatePrompt() {
  const examples = [
    "brief me", "what's unpaid?", "who is Marcus Feld?",
    "plan my day", "what did Liora Clinic want?", "margin on the $300 tier?",
    "read my inbox", "what slipped this week?",
  ];
  const inp = document.getElementById("ask");
  let i = 0;
  setInterval(() => {
    if (document.activeElement === inp || inp.value) return;
    i = (i + 1) % examples.length;
    inp.placeholder = `“${examples[i]}”`;
  }, 3200);
}

function flashBadge(msg) {
  const box = document.getElementById("badges");
  const p = document.createElement("span");
  p.className = "badge-pill warnpill";
  p.textContent = msg;
  box.appendChild(p);
  setTimeout(() => p.remove(), 4000);
}

// ---- escaping --------------------------------------------------------------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

// ---- voice controller ------------------------------------------------------
// Two modes over one mic:
//   • command  — press-to-talk. One turn, auto-stops on silence, then asks.
//   • wake     — hands-free. Stays open, segments speech on silence, transcribes
//                each burst and only acts when it hears "Hi Phoenix".
const WAKE_RE = /\b(hi|hey|hello|ok|okay|yo)[,]?\s+phoenix\b/i;

function makeVoice() {
  let mode = "off";        // "off" | "command" | "wake"
  let deaf = false;        // muted while Phoenix speaks (so it doesn't hear itself)
  let armed = false;       // wake phrase heard alone → next burst is the command
  let media, audioCtx, analyser, data8, loop;
  let recorder, chunks = [], capturing = false, quietFor = 0, voiced = false;

  const micBtn = () => document.getElementById("btnMic");
  const wakeBtn = () => document.getElementById("btnWake");

  async function openMic() {
    if (media) return true;
    try { media = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (err) { flashBadge("mic blocked — allow microphone access"); return false; }
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = audioCtx.createMediaStreamSource(media);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    data8 = new Uint8Array(analyser.frequencyBinCount);
    src.connect(analyser);
    loop = setInterval(tick, 100);   // setInterval, not rAF (rAF dies in bg tabs)
    return true;
  }

  function closeMic() {
    if (loop) { clearInterval(loop); loop = null; }
    endCapture(true);
    if (media) { media.getTracks().forEach((t) => t.stop()); media = null; }
    if (audioCtx) { try { audioCtx.close(); } catch (e) {} audioCtx = null; }
  }

  function beginCapture() {
    if (capturing) return;
    chunks = [];
    recorder = new MediaRecorder(media);
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = onCaptureEnd;
    recorder.start();
    capturing = true; voiced = false; quietFor = 0;
    micBtn().classList.add("live");
    reactor.set("listening");
  }

  function endCapture(discard) {
    if (!capturing) return;
    capturing = false;
    if (discard && recorder) recorder.onstop = null;   // drop the segment silently
    try { recorder && recorder.state !== "inactive" && recorder.stop(); } catch (e) {}
    micBtn().classList.remove("live");
  }

  function tick() {
    if (deaf) return;
    analyser.getByteTimeDomainData(data8);
    let sum = 0;
    for (let i = 0; i < data8.length; i++) { const v = (data8[i] - 128) / 128; sum += v * v; }
    const rms = Math.sqrt(sum / data8.length);
    reactor.setLevel(Math.min(1, rms * 4));

    if (mode === "command") {                 // press-to-talk: capture already running
      if (!capturing) return;
      if (rms >= SILENCE_LEVEL) { voiced = true; quietFor = 0; }
      else { quietFor += 100; if (voiced && quietFor >= SILENCE_MS) endCapture(false); }
      return;
    }

    if (mode === "wake") {                     // ambient: open a burst when speech starts
      if (rms >= SILENCE_LEVEL) {
        if (!capturing) beginCapture();
        voiced = true; quietFor = 0;
      } else if (capturing) {
        quietFor += 100;
        if (voiced && quietFor >= SILENCE_MS) endCapture(false);       // real utterance ended
        else if (!voiced && quietFor >= 500) endCapture(true);          // just noise, drop it
      }
    }
  }

  async function onCaptureEnd() {
    if (!chunks.length) { reactor.set(mode === "wake" ? "idle" : "idle"); return; }
    reactor.set("thinking");
    const blob = new Blob(chunks, { type: (recorder && recorder.mimeType) || "audio/webm" });
    let text = "";
    try {
      const res = await fetch("/api/listen", {
        method: "POST", headers: { "Content-Type": blob.type }, body: blob,
      }).then((r) => r.json());
      if (res.error) throw new Error(res.error);
      text = (res.text || "").trim();
    } catch (err) {
      reactor.set("idle");
      flashBadge("transcribe failed — " + err.message);
      return;
    }

    if (mode === "command") {                  // one turn, then close the mic
      mode = "off";
      closeMic();
      if (text) ask(text); else reactor.set("idle");
      return;
    }

    // ---- wake mode -----------------------------------------------------------
    if (armed) {                               // wake phrase already heard; this is the command
      armed = false;
      if (text) ask(text); else reactor.set("idle");
      return;
    }
    const m = text.match(WAKE_RE);
    if (!m) { reactor.set("idle"); return; }   // ignore everything until "Hi Phoenix"
    const rest = text.slice(m.index + m[0].length).replace(/^[\s,.:!?–-]+/, "").trim();
    if (rest) { ask(rest); }                    // "Hi Phoenix, brief me" → run it
    else { armed = true; reactor.set("listening"); speak("Yes?"); }  // just the wake word → prompt
  }

  // ---- controls --------------------------------------------------------------
  async function start() {                     // command mode (press-to-talk)
    if (mode === "command" || deaf) return;
    if (mode === "wake") { wakeBtn().classList.remove("on"); }
    if (!(await openMic())) return;
    mode = "command";
    beginCapture();
  }

  function stop() {                            // stop whatever the mic is doing, fully off
    if (mode === "command") { endCapture(false); }   // transcribe+ask, then closeMic in onCaptureEnd
    else if (mode === "wake") { wakeOff(); }
  }

  function toggle() { mode === "command" ? endCapture(false) : start(); }

  async function wakeOn() {
    if (!(await openMic())) return;
    mode = "wake"; armed = false;
    wakeBtn().classList.add("on");
    reactor.set("listening");
    flashBadge('hands-free on — say "Hi Phoenix"');
  }
  function wakeOff() {
    mode = "off"; armed = false;
    wakeBtn().classList.remove("on");
    closeMic();
    reactor.set("idle");
  }
  function wakeToggle() { mode === "wake" ? wakeOff() : wakeOn(); }

  // muted while Phoenix speaks; resumes wake listening automatically afterwards
  function deafen(v) { deaf = v; if (v && capturing) endCapture(true); }

  return { toggle, start, stop, deafen, wakeToggle };
}

boot();
