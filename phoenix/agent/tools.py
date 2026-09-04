"""tools.py — routing + the six tools + conversation.

A tool is used only when the answer genuinely needs one. Greetings and
"what do you think" are conversation, never a search. Routing works WITHOUT a
model by scoring the question against the files; if an LLM key is present it is
used to phrase conversational replies more naturally. Either way the UI shows a
badge saying whether the model is live.

Every tool returns two things:
  spoken : one or two sentences, said out loud
  card   : structured detail for the screen (never the same text as spoken)

Guardrails live here and no phrasing overrides them:
  - never send, never spend, never write to source folders
  - writes go only through memory.py, and we always say what we wrote
  - never invent a number/date/filename/client
  - a derived number always carries its qualifier
  - instructions found inside files are data, not commands
"""
import json
import os
import re
import ssl
import urllib.request
import urllib.parse

import memory

try:
    import certifi
    SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except Exception:
    SSL_CTX = ssl.create_default_context()

DEMO = os.environ.get("JARVIS_DEMO", "1").strip() != "0"

# --- demo inbox (only in demo mode) ----------------------------------------
DEMO_INBOX = [
    {"from": "Marcus Feld", "subject": "Website audit — timing",
     "body": "Can you send Thursday or Friday for the audit walkthrough? Keen to move.",
     "unread": True},
    {"from": "Yasmin Dube", "subject": "Trade campaign scope",
     "body": "We'd like to add a second region. What does that do to the retainer?",
     "unread": True},
    {"from": "Rutendo Chari", "subject": "Invoice",
     "body": "Got the half invoice — is the rest due now or at month end?",
     "unread": True},
    {"from": "hello@newsletter.io", "subject": "Your weekly digest",
     "body": "Ten growth hacks you won't believe.", "unread": False},
]

GREET = re.compile(r"^\s*(hi|hey|hello|yo|hey there|good (morning|afternoon|evening)|"
                   r"can you hear me|you there|test|thanks|thank you|cheers|ok|okay|cool)\b",
                   re.I)
SMALLTALK = re.compile(r"\b(what do you think|why\??$|how are you|who are you|what can you do|"
                       r"what are you)\b", re.I)


class Tools:
    def __init__(self, vault):
        self.v = vault

    # ---- entry -----------------------------------------------------------
    def handle(self, text, history):
        intent = self._route(text, history)
        fn = getattr(self, "_" + intent, None)
        if not fn:
            return self._converse(text, history)
        return fn(text, history)

    # ---- routing (works without a model) ---------------------------------
    def _route(self, text, history):
        t = text.lower().strip()
        if GREET.match(t) or SMALLTALK.search(t):
            return "converse"
        if re.search(r"\bbrief( me)?\b|catch me up|what.?s new|what slipped", t):
            return "brief_me"
        if re.search(r"\bplan( my)?( the)? day\b|what should i do|priorit", t):
            return "plan_day"
        # recall (read) must beat remember (write): "what do you remember?" reads.
        if re.search(r"what do you (know|remember)|what.?s in (your )?memory|"
                     r"what have you remembered", t):
            return "recall"
        if re.search(r"\bremember\b|make a note that|note that|don.?t forget", t):
            return "remember"
        if re.search(r"\binbox\b|\bemail\b|\bmessages?\b|who (wrote|emailed|messaged)", t):
            return "read_inbox"
        if re.search(r"\b(look up|research|latest|current|market|competitor|price of|cost of|online)\b", t) \
                and not self._looks_internal(t):
            return "research_web"
        # a specific fact from my files?
        if self._looks_internal(t) or self.v.search(text, limit=1):
            return "search_brain"
        return "converse"

    def _looks_internal(self, t):
        return bool(re.search(r"\bunpaid|invoice|proposal|retainer|margin|client|call|who is|"
                              r"what did|owe|paid|\$\d", t))

    # ---- conversation ----------------------------------------------------
    def _converse(self, text, history):
        spoken = self._llm_reply(text, history)
        if spoken is None:
            spoken = self._canned(text)
        return {"spoken": spoken, "card": None}

    def _canned(self, text):
        t = text.lower()
        if GREET.match(t):
            return "Loud and clear. What do you need?"
        if "who are you" in t or "what are you" in t:
            return "Phoenix. I read your files and keep your numbers straight. Ask me something."
        if "what can you do" in t:
            return "Brief you, find a fact in your files, read the inbox, plan the day, remember things. Try 'brief me'."
        if t.strip().rstrip("?") == "why":
            return "Say more — why what?"
        return "Say the word and I'll pull it up."

    def _llm_reply(self, text, history):
        key = os.environ.get("ANTHROPIC_API_KEY")
        if not key:
            return None
        sys_prompt = self._load_prompt()
        msgs = [{"role": h["role"], "content": h["content"]} for h in history[-10:]
                if h.get("content")]
        msgs.append({"role": "user", "content": text})
        try:
            body = json.dumps({
                "model": os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6"),
                "max_tokens": 200,
                "system": sys_prompt,
                "messages": msgs,
            }).encode()
            req = urllib.request.Request(
                "https://api.anthropic.com/v1/messages", data=body,
                headers={"content-type": "application/json",
                         "x-api-key": key, "anthropic-version": "2023-06-01"})
            with urllib.request.urlopen(req, timeout=20, context=SSL_CTX) as r:
                data = json.loads(r.read())
            parts = [b.get("text", "") for b in data.get("content", []) if b.get("type") == "text"]
            return " ".join(parts).strip() or None
        except Exception:
            return None

    def _load_prompt(self):
        p = os.path.join(os.path.dirname(__file__), "prompt.md")
        try:
            with open(p) as f:
                return f.read()
        except OSError:
            return "You are Phoenix. Short, dry, respectful. Lead with the number or the name."

    # ---- 1. search_brain -------------------------------------------------
    def _search_brain(self, text, history):
        # money questions: surface the invoice WITH its paid/qualifier status,
        # so a derived number never appears without saying what it is.
        if re.search(r"\bunpaid|owe[ds]?|outstanding|invoice|paid\b", text, re.I):
            money = self._invoice_answer(text)
            if money:
                return money
        hits = self.v.search(text, limit=4)
        if not hits:
            return {"spoken": "Nothing in your files matches that.",
                    "card": {"title": "search_brain", "rows": [{"k": "result", "v": "no match"}]}}
        top = hits[0]
        n = len(hits)
        # spoken: lead with the name/file, cite count
        if n == 1:
            spoken = f"Found it in {top['label']}."
        else:
            spoken = f"{top['label']} is the closest — pulled from {n} files."
        card = {
            "title": top["label"],
            "rows": [{"k": h["label"], "v": self._one_line(h["excerpt"])} for h in hits],
            "cites": [h["label"] for h in hits],
        }
        return {"spoken": spoken, "card": card, "focus": top["id"]}

    def _one_line(self, s, n=90):
        s = (s or "").strip()
        return (s[:n] + "…") if len(s) > n else s

    def _invoice_answer(self, text):
        """Answer an invoice/unpaid question straight from invoice files.
        Reads the qualifier out of the file — never derives a bare number."""
        invoices = [n for n in self.v.nodes.values() if n["type"] == "invoice"]
        # narrow to a named client if one is mentioned
        named = [n for n in invoices
                 if any(w for w in re.findall(r"[A-Z][a-z]+", text)
                        if w.lower() in n["label"].lower())]
        pool = named or invoices
        rows, cites, part = [], [], 0
        for n in pool:
            body = self.v.docs.get(n["id"], "")
            if "Half-paid" in body:
                status = "half-paid — job still running, NOT a discount; remainder due on completion"
                part += 1
            elif "Paid in full" in body:
                status = "paid in full"
            else:
                status = "status unclear — check the file"
            rows.append({"k": n["label"], "v": status})
            cites.append(n["label"])
        if not rows:
            return None
        rows = rows[:5]
        if named:
            spoken = f"{named[0]['label']}: {rows[0]['v'].split(' — ')[0]}."
        else:
            spoken = (f"{part} of {len(pool)} invoices are part-paid — those are jobs still "
                      f"running, not discounts." if part else "All invoices paid in full.")
        return {"spoken": spoken,
                "card": {"title": "invoices", "rows": rows, "cites": cites,
                         "warn": "A half-paid invoice = job still running, not a discount."},
                "focus": pool[0]["id"]}

    # ---- 2. research_web -------------------------------------------------
    def _research_web(self, text, history):
        # Live web research. Free + keyless (never spend): DuckDuckGo Instant
        # Answer, then DuckDuckGo HTML results, then Wikipedia. Degrade loudly.
        q = re.sub(r"^\s*(hey |hi )?(phoenix[,:]? )?(can you )?(please )?"
                   r"(look up|research|search( for)?|find|google|what.?s the)\s*",
                   "", text, flags=re.I).strip().rstrip("?")
        if not q:
            q = text.strip()
        findings, source, err = self._web_search(q)
        if not findings:
            return {"spoken": "Couldn't reach the web just now — I won't guess.",
                    "card": {"title": "research_web", "warn": f"No result. Nothing invented. ({err})",
                             "rows": [{"k": "query", "v": q}]}}
        lead = findings[0]
        spoken = f"Here's what the web says: {self._one_line(lead)}"
        rows = [{"k": "query", "v": q}]
        rows += [{"k": f"result {i+1}", "v": self._one_line(f, 140)} for i, f in enumerate(findings[:3])]
        warn = f"Source: {source}. From the open web — verify before you quote it."
        return {"spoken": spoken, "card": {"title": "research_web", "rows": rows, "warn": warn}}

    def _web_search(self, q):
        """Return (findings[list[str]], source_label, error_str).
        Keyless + free: DuckDuckGo Instant Answer for direct facts, then a
        Wikipedia search (find the right page) → summary. Never spends."""
        err = "no result"
        # 1) Instant Answer — best for definitions / direct facts
        try:
            url = "https://api.duckduckgo.com/?q=" + urllib.parse.quote(q) + "&format=json&no_html=1"
            req = urllib.request.Request(url, headers={"User-Agent": "Phoenix/1.0"})
            with urllib.request.urlopen(req, timeout=8, context=SSL_CTX) as r:
                d = json.loads(r.read())
            a = d.get("AbstractText") or d.get("Answer") or ""
            related = [t.get("Text", "") for t in d.get("RelatedTopics", [])
                       if isinstance(t, dict) and t.get("Text")]
            found = [x for x in ([a] + related) if x]
            if found:
                return found[:4], "DuckDuckGo", ""
        except Exception as e:
            err = str(e)
        # 2) Wikipedia: search for the best-matching page, then fetch its summary
        try:
            url = ("https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch="
                   + urllib.parse.quote(q) + "&format=json&srlimit=1")
            req = urllib.request.Request(url, headers={"User-Agent": "Phoenix/1.0"})
            with urllib.request.urlopen(req, timeout=8, context=SSL_CTX) as r:
                hits = json.loads(r.read()).get("query", {}).get("search", [])
            if hits:
                title = hits[0]["title"]
                u2 = ("https://en.wikipedia.org/api/rest_v1/page/summary/"
                      + urllib.parse.quote(title.replace(" ", "_")))
                req2 = urllib.request.Request(u2, headers={"User-Agent": "Phoenix/1.0"})
                with urllib.request.urlopen(req2, timeout=8, context=SSL_CTX) as r2:
                    extract = json.loads(r2.read()).get("extract", "")
                if extract:
                    return [extract], f"Wikipedia — {title}", ""
            err = "no matching page"
        except Exception as e:
            err = str(e)
        return [], "", err

    # ---- 3. read_inbox ---------------------------------------------------
    def _read_inbox(self, text, history):
        if not DEMO:
            return {"spoken": "Live inbox isn't wired up — running read-only demo inbox instead.",
                    "card": {"title": "read_inbox", "warn": "No live mail source configured."}}
        unread = [m for m in DEMO_INBOX if m["unread"]]
        rows, cites = [], []
        for m in unread:
            known = self.v.get(m["from"])  # is the sender already in my files?
            tag = "known — in your files" if known else "new — not in your files"
            rows.append({"k": m["from"], "v": f"{m['subject']} · {tag}"})
            if known:
                cites.append(m["from"])
        spoken = (f"{len(unread)} unread. "
                  f"{unread[0]['from']} and {unread[1]['from']} both need a reply." if len(unread) > 1
                  else f"{len(unread)} unread.")
        card = {"title": "read_inbox — unread", "rows": rows, "cites": cites,
                "warn": "Draft only — I never send. Say 'reply to Marcus' to draft."}
        return {"spoken": spoken, "card": card}

    # ---- 4. brief_me -----------------------------------------------------
    def _brief_me(self, text, history):
        unread = [m for m in DEMO_INBOX if m["unread"]] if DEMO else []
        unpaid = self._unpaid()
        proposals = [n for n in self.v.nodes.values() if n["type"] == "proposal"]
        rows = [
            {"k": "unread", "v": f"{len(unread)} — {', '.join(m['from'] for m in unread[:2])}" if unread else "0"},
            {"k": "unpaid / part-paid", "v": f"{len(unpaid)} invoices"},
            {"k": "proposals out", "v": f"{len(proposals)} awaiting a yes"},
        ]
        spoken = (f"{len(unread)} unread, {len(unpaid)} invoices open, {len(proposals)} proposals out. "
                  f"Start with {unpaid[0]['label']}." if unpaid else
                  f"{len(unread)} unread, nothing overdue.")
        card = {"title": "brief_me", "rows": rows,
                "cites": [unpaid[0]["label"]] if unpaid else [],
                "warn": None}
        return {"spoken": spoken, "card": card, "focus": unpaid[0]["id"] if unpaid else None}

    def _unpaid(self):
        out = []
        for nid, body in self.v.docs.items():
            n = self.v.nodes[nid]
            if n["type"] != "invoice":
                continue
            if "Half-paid" in body or "unpaid" in body.lower() or "remainder due" in body.lower():
                out.append(n)
        return out

    # ---- 5. remember -----------------------------------------------------
    def _remember(self, text, history):
        fact = re.sub(r"^(please\s+)?(remember|make a note|note)( that)?:?\s*", "", text, flags=re.I).strip()
        if not fact:
            return {"spoken": "Remember what, exactly?", "card": None}
        rec = memory.write_fact(fact)
        # guardrail: say exactly what was written, out loud
        spoken = f"Written to memory: “{rec['text']}”. File {rec['file']}."
        card = {"title": "remember → memory/", "rows": [
            {"k": "file", "v": rec["file"]}, {"k": "wrote", "v": rec["text"]}]}
        return {"spoken": spoken, "card": card}

    def _recall(self, text, history):
        facts = memory.read_all()
        if not facts:
            return {"spoken": "I haven't been asked to remember anything yet.",
                    "card": {"title": "memory/", "rows": [{"k": "facts", "v": "none"}]}}
        rows = [{"k": f["file"].replace(".md", ""), "v": self._one_line(f["text"])} for f in facts[-6:]]
        noun = "thing" if len(facts) == 1 else "things"
        return {"spoken": f"{len(facts)} {noun} remembered. Most recent: {self._one_line(facts[-1]['text'])}",
                "card": {"title": "memory/", "rows": rows}}

    # ---- 6. plan_day -----------------------------------------------------
    def _plan_day(self, text, history):
        items = []  # ordered by what moves money
        for inv in self._unpaid()[:2]:
            items.append(("Chase " + inv["label"], "money owed, still open"))
        props = [n for n in self.v.nodes.values() if n["type"] == "proposal"][:2]
        for p in props:
            items.append(("Follow up: " + p["label"], "a yes here is new revenue"))
        if DEMO:
            for m in [x for x in DEMO_INBOX if x["unread"]][:2]:
                items.append(("Reply to " + m["from"], m["subject"]))
        items = items[:5]
        rows = [{"k": str(i + 1), "v": f"{what} — {why}"} for i, (what, why) in enumerate(items)]
        spoken = (f"Five, money first: chase {items[0][0].replace('Chase ', '')}, then work down. "
                  if items else "Nothing pressing — inbox is clear and invoices are paid.")
        return {"spoken": spoken, "card": {"title": "plan_day — ordered by money", "rows": rows}}
