#!/usr/bin/env python3
"""main.py — Phoenix HTTP server + API.

Python standard library only. Serves the UI and a small JSON API:

  GET  /                 -> ui/index.html
  GET  /ui/*             -> static assets
  GET  /api/graph        -> the vault graph (nodes + edges)
  GET  /api/node?id=     -> one note's detail
  GET  /api/path?a=&b=   -> shortest path between two nodes
  GET  /api/status       -> which subsystems are live (model, voice, source)
  POST /api/ask          -> conversation + tools (spoken line + card)
  POST /api/speak        -> text -> ElevenLabs mp3 bytes
  POST /api/listen       -> audio blob -> ElevenLabs Scribe transcript

The ElevenLabs / model keys live only on this server. The browser never sees
them: it posts text/audio and gets back mp3 bytes or JSON.
"""
import json
import os
import sys

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
UI_DIR = os.path.join(ROOT, "ui")

sys.path.insert(0, HERE)

import data       # noqa: E402
from vault import Vault  # noqa: E402


def load_env():
    """Tiny .env loader — no dependency on python-dotenv."""
    path = os.path.join(ROOT, ".env")
    if not os.path.isfile(path):
        return
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip())


load_env()

VAULT = Vault().build()

# Lazy imports so the graph works even if optional deps/keys are missing.
_tools = None
_voice = None


def tools_mod():
    global _tools
    if _tools is None:
        import tools
        _tools = tools.Tools(VAULT)
    return _tools


def voice_mod():
    global _voice
    if _voice is None:
        import voice
        _voice = voice
    return _voice


CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
}


class Handler(BaseHTTPRequestHandler):
    server_version = "Phoenix/1.0"

    def log_message(self, fmt, *args):
        sys.stderr.write("  " + (fmt % args) + "\n")

    # ---- helpers ---------------------------------------------------------
    def _send_json(self, obj, code=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_bytes(self, blob, ctype, code=200):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(blob)))
        self.end_headers()
        self.wfile.write(blob)

    def _send_file(self, path):
        if not os.path.isfile(path):
            self._send_json({"error": "not found"}, 404)
            return
        ext = os.path.splitext(path)[1].lower()
        ctype = CONTENT_TYPES.get(ext, "application/octet-stream")
        with open(path, "rb") as f:
            blob = f.read()
        # never cache during dev — modules go stale otherwise
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(blob)))
        self.end_headers()
        self.wfile.write(blob)

    def _body(self):
        length = int(self.headers.get("Content-Length", 0))
        return self.rfile.read(length) if length else b""

    # ---- routing ---------------------------------------------------------
    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)

        if path == "/" or path == "/index.html":
            return self._send_file(os.path.join(UI_DIR, "index.html"))

        if path.startswith("/ui/"):
            rel = path[len("/ui/"):]
            safe = os.path.normpath(rel).lstrip(os.sep)
            return self._send_file(os.path.join(UI_DIR, safe))

        if path == "/api/graph":
            return self._send_json(VAULT.graph())

        if path == "/api/status":
            return self._send_json(self._status())

        if path == "/api/node":
            nid = (qs.get("id") or [""])[0]
            n = VAULT.get(nid)
            if not n:
                return self._send_json({"error": "not found"}, 404)
            return self._send_json({
                **n,
                "neighbors": VAULT.neighbors(nid),
                "body": VAULT.docs.get(nid, ""),
            })

        if path == "/api/path":
            a = (qs.get("a") or [""])[0]
            b = (qs.get("b") or [""])[0]
            return self._send_json({"path": VAULT.shortest_path(a, b)})

        return self._send_json({"error": "not found"}, 404)

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/ask":
            try:
                payload = json.loads(self._body() or b"{}")
            except json.JSONDecodeError:
                return self._send_json({"error": "bad json"}, 400)
            text = (payload.get("text") or "").strip()
            history = payload.get("history") or []
            if not text:
                return self._send_json({"error": "empty"}, 400)
            result = tools_mod().handle(text, history)
            return self._send_json(result)

        if path == "/api/speak":
            try:
                payload = json.loads(self._body() or b"{}")
            except json.JSONDecodeError:
                return self._send_json({"error": "bad json"}, 400)
            text = (payload.get("text") or "").strip()
            if not text:
                return self._send_json({"error": "empty"}, 400)
            try:
                mp3 = voice_mod().speak(text)
            except Exception as e:  # degrade loudly
                return self._send_json({"error": str(e)}, 502)
            return self._send_bytes(mp3, "audio/mpeg")

        if path == "/api/listen":
            blob = self._body()
            ctype = self.headers.get("Content-Type", "audio/webm")
            try:
                transcript = voice_mod().listen(blob, ctype)
            except Exception as e:
                return self._send_json({"error": str(e)}, 502)
            return self._send_json({"text": transcript})

        return self._send_json({"error": "not found"}, 404)

    def _status(self):
        return {
            "source": data.source_label(),
            "model": bool(os.environ.get("ANTHROPIC_API_KEY")),
            "voice": bool(os.environ.get("ELEVENLABS_API_KEY")),
            "nodes": len(VAULT.nodes),
            "edges": len(VAULT.edges),
            "counts": VAULT.type_counts(),
        }


def main():
    port = int(os.environ.get("PHOENIX_PORT", "8720"))
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print("  PHOENIX")
    print(f"  source: {data.source_label()}   nodes: {len(VAULT.nodes)}   edges: {len(VAULT.edges)}")
    print(f"  model:  {'on' if os.environ.get('ANTHROPIC_API_KEY') else 'OFF (file-scored routing)'}")
    print(f"  voice:  {'on' if os.environ.get('ELEVENLABS_API_KEY') else 'OFF'}")
    print(f"  http://127.0.0.1:{port}\n")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n  bye")


if __name__ == "__main__":
    main()
