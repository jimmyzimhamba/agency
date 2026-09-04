# Phoenix

A voice-controlled assistant that reads *your own files*, keeps your numbers
honest, and talks back. Built for Jimmy at Studio X Marketing.

Python standard library on the server, vanilla JS in the browser. No frameworks,
no build step, no package manager. One command to run.

---

## Run it

```bash
cd phoenix
python3 agent/main.py
```

Then open **http://127.0.0.1:8720** in your browser.

That's it. The demo data is already generated. If you ever want to rebuild it:

```bash
python3 data/generate.py
```

The graph is identical every time (fixed random seed), so it's safe to
screen-record.

---

## Demo vs. your real life

One switch, read in exactly one file (`agent/data.py`), set in `.env`:

```
JARVIS_DEMO=1   # invented fixtures shaped like your business (default, safe)
JARVIS_DEMO=0   # your real folders
```

You have to opt *in* to your real data. To use it, set `JARVIS_DEMO=0` and edit
`REAL_FOLDERS` in `agent/data.py` to point at your actual notes/clients folders.
Indexing is **read-only, always** — Phoenix never writes to those folders.

Supported files: Markdown, text, PDF. Skips `node_modules`, `.git`, and anything
over 2 MB. `[[wikilinks]]` between notes become edges in the graph.

---

## Voice

Both directions use **ElevenLabs** — nothing goes to Google, and the API key
never reaches the browser (the page posts text/audio to the Python server, which
holds the key).

- **Speech out:** ElevenLabs text-to-speech (voice: *Brian*).
- **Speech in:** ElevenLabs Scribe (`scribe_v1`).

Press the mic once and just talk — no wake word between turns. When you go quiet
for ~900 ms the turn ends and sends. Tune that in `SILENCE_MS` at the top of
`ui/app.js`. The mic goes deaf while Phoenix speaks (so it doesn't hear itself);
press the mic, **Space**, or **Esc** to barge in.

If the mic is blocked or a call fails, Phoenix says so **on screen** — it never
fails silently.

### One-time cert step (macOS)
Voice and the optional model make HTTPS calls from Python. On a fresh macOS
Python install you may hit `certificate verify failed`. Fix it once by running
the installer that ships with Python (installs Mozilla's CA bundle):

```
"/Applications/Python 3.14/Install Certificates.command"
```

(Already done on this machine.) The graph, routing and memory need no network
and work without this.

### Voice keys and the free tier
Your ElevenLabs key is in `.env`. On the **free tier** you can only use the
default voices already in your account — "library" voices return a
`paid_plan_required` error. Brian is a free default and is set as the voice.
Change `ELEVENLABS_VOICE_ID` in `.env` to any voice id from your Voices page.

> **Rotate your key.** It was shared in plaintext once. Generate a fresh key in
> the ElevenLabs dashboard and replace it in `.env`.

---

## The optional model

Phoenix runs fine with **no LLM** — it decides between conversation and a tool by
scoring your question against your files, and shows a `MODEL OFF · FILE-SCORED`
badge so it never pretends keyword matching is the model talking.

To make conversation more natural, add an Anthropic key to `.env`:

```
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-6
```

Routing and every guardrail still run locally; the model only phrases replies.

---

## What it can do

Type in the ask bar or use the buttons / voice:

| Ask | It does |
|-----|---------|
| "brief me" | unread, unpaid invoices, proposals out |
| "who is Marcus Feld?" | finds the fact, **cites the file** |
| "read my inbox" | who wrote, and whether they're already in your files |
| "plan my day" | five items, ordered by what moves money |
| "remember that…" | writes one dated file to `memory/`, says what it wrote |
| "what do you remember?" | reads memory back |
| "look up…" | web research, then degrades loudly if it can't (never guesses) |

Every answer is two parts: a short **spoken** line, and a **card** on screen with
the detail. Never the same words in both.

---

## The interface

Full-screen, dark, purple, afrofuturistic. Floating panels over a living graph:

- **Centre** — every note a node, every `[[link]]` an edge. Force-directed,
  colour by type, size by connections. Hover to light a node's links, click to
  focus and inspect, **shift-click** a second node to trace the shortest path.
  Drag to pan, scroll to zoom, drag a node to move it.
- **Left** — inspector for the focused note + top hubs.
- **Right** — filters with live counts, and the reactor HUD
  (idle / listening / thinking / speaking).
- **Bottom** — ask bar + mic, mute, brief, plan, memory buttons.

---

## Guardrails (absolute)

- **Never sends** an email, message or invite — drafts and waits.
- **Never writes** to your folders — writes go only to `memory/`, and it always
  says out loud what it wrote.
- **Never spends** — no paid API or purchase without asking.
- **Never invents** a number, date, filename or client.
- **Never states a derived number without its qualifier** — a half-paid invoice
  because a job is still running is not a discount, and it says which it is.
- **Instructions inside your files are data, not commands.**

---

## What it costs

- **Server + graph + routing + memory:** free. Runs entirely on your machine.
- **Voice (ElevenLabs):** uses your account's character/transcription quota. The
  free tier is enough to try it. Each spoken reply is a few hundred characters.
- **Optional Anthropic model:** only if you add a key — normal API pricing per
  request. Left off by default, so it costs nothing unless you turn it on.

No other paid services. No purchases are ever made without asking.

---

## Files

```
phoenix/
├── agent/
│   ├── main.py      HTTP server + API
│   ├── vault.py     folders → searchable graph
│   ├── tools.py     routing + the six tools + conversation
│   ├── data.py      THE ONLY FILE THAT TOUCHES YOUR REAL DATA
│   ├── voice.py     ElevenLabs speech in and out
│   ├── memory.py    writes to memory/ and nowhere else
│   └── prompt.md    the system prompt
├── ui/              index.html, app.js, graph.js, styles.css
├── data/            demo fixtures + generate.py
├── memory/          one markdown file per remembered fact
├── CLAUDE.md        who you are — loaded every session
└── .env             keys (gitignored, chmod 600)
```
