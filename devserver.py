"""Tiny static file server for local testing — sends no-cache headers so
the browser always fetches the latest edits instead of stale JS/CSS."""
import http.server
import sys

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        super().end_headers()

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8532
    directory = sys.argv[2] if len(sys.argv) > 2 else "app"
    handler = lambda *args, **kwargs: NoCacheHandler(*args, directory=directory, **kwargs)
    http.server.ThreadingHTTPServer(("", port), handler).serve_forever()
