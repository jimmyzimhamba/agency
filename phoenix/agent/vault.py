"""vault.py — folders -> searchable graph.

Read-only. Walks the folders data.py hands it, parses markdown/text/PDF,
reads a `type:` from frontmatter (or infers one), and treats [[wikilinks]]
as edges. Builds an in-memory graph + a simple full-text search index.

No third-party libraries. PDF text is extracted with a tiny built-in reader
that handles the common uncompressed/Flate cases; if a PDF can't be read it
is indexed by filename only, never crashed on.
"""
import os
import re
import zlib

import data

MAX_BYTES = 2 * 1024 * 1024  # skip anything over 2 MB
SKIP_DIRS = {"node_modules", ".git", ".obsidian", "__pycache__", "venv", ".venv"}
TEXT_EXT = {".md", ".markdown", ".txt"}
WIKILINK = re.compile(r"\[\[([^\]|]+)(?:\|[^\]]+)?\]\]")
FRONTMATTER_TYPE = re.compile(r"^type:\s*(.+)$", re.MULTILINE)

# Fallback type inference from filename prefix when there's no frontmatter.
INFER = [
    ("call", "call"), ("note", "note"), ("invoice", "invoice"),
    ("proposal", "proposal"), ("brief", "brief"), ("campaign", "campaign"),
    ("sop", "sop"), ("project", "project"),
]


def _read_pdf(path: str) -> str:
    """Best-effort PDF text extraction, stdlib only. Returns '' on failure."""
    try:
        with open(path, "rb") as f:
            raw = f.read()
    except OSError:
        return ""
    chunks = []
    for m in re.finditer(rb"stream\r?\n(.*?)\r?\nendstream", raw, re.DOTALL):
        blob = m.group(1)
        try:
            blob = zlib.decompress(blob)
        except zlib.error:
            pass
        # pull text out of ( ) and <..> show operators, roughly
        for t in re.findall(rb"\((.*?)\)", blob):
            try:
                chunks.append(t.decode("latin-1", "ignore"))
            except Exception:
                pass
    text = " ".join(chunks)
    return re.sub(r"\s+", " ", text)


def _read_file(path: str, ext: str) -> str:
    if ext == ".pdf":
        return _read_pdf(path)
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            return f.read()
    except OSError:
        return ""


def _infer_type(stem: str) -> str:
    low = stem.lower()
    for prefix, t in INFER:
        if low.startswith(prefix):
            return t
    return "note"


class Vault:
    def __init__(self):
        self.nodes = {}   # id -> {id,label,type,degree,path,excerpt}
        self.edges = []   # list of {source, target}
        self.docs = {}    # id -> full text (lowercased kept separately for search)
        self._search_blob = {}  # id -> lowercased text
        self.warnings = []

    # ---- build -----------------------------------------------------------
    def build(self):
        self.__init__()
        seen_paths = set()
        for root in data.source_folders():
            if not os.path.isdir(root):
                self.warnings.append(f"missing folder: {root}")
                continue
            for dirpath, dirnames, filenames in os.walk(root):
                dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
                for fn in filenames:
                    ext = os.path.splitext(fn)[1].lower()
                    if ext not in TEXT_EXT and ext != ".pdf":
                        continue
                    full = os.path.join(dirpath, fn)
                    if full in seen_paths:
                        continue
                    seen_paths.add(full)
                    try:
                        if os.path.getsize(full) > MAX_BYTES:
                            continue
                    except OSError:
                        continue
                    self._ingest(full, fn, ext)
        self._resolve_edges()
        self._compute_degree()
        return self

    def _ingest(self, full, fn, ext):
        stem = os.path.splitext(fn)[0]
        text = _read_file(full, ext)
        mt = FRONTMATTER_TYPE.search(text or "")
        ntype = (mt.group(1).strip().lower() if mt else _infer_type(stem))
        node_id = stem  # wikilinks target by filename stem
        excerpt = self._excerpt(text)
        self.nodes[node_id] = {
            "id": node_id,
            "label": stem,
            "type": ntype,
            "degree": 0,
            "path": full,
            "excerpt": excerpt,
        }
        self.docs[node_id] = text
        self._search_blob[node_id] = (stem + "\n" + (text or "")).lower()
        # collect raw link targets now, resolve after all nodes exist
        for tgt in WIKILINK.findall(text or ""):
            self.edges.append({"source": node_id, "_raw_target": tgt.strip()})

    def _excerpt(self, text):
        if not text:
            return ""
        body = re.sub(r"^---.*?---", "", text, count=1, flags=re.DOTALL)
        body = re.sub(r"[#>*_`\[\]]", "", body)
        body = re.sub(r"\s+", " ", body).strip()
        return body[:280]

    def _resolve_edges(self):
        resolved = []
        # index by lowercased label for fuzzy-ish matching
        by_lower = {v["label"].lower(): k for k, v in self.nodes.items()}
        for e in self.edges:
            raw = e.get("_raw_target", "")
            tgt = None
            if raw in self.nodes:
                tgt = raw
            elif raw.lower() in by_lower:
                tgt = by_lower[raw.lower()]
            if tgt and tgt != e["source"]:
                resolved.append({"source": e["source"], "target": tgt})
        # dedupe undirected
        seen = set()
        uniq = []
        for e in resolved:
            key = tuple(sorted((e["source"], e["target"])))
            if key in seen:
                continue
            seen.add(key)
            uniq.append(e)
        self.edges = uniq

    def _compute_degree(self):
        for e in self.edges:
            if e["source"] in self.nodes:
                self.nodes[e["source"]]["degree"] += 1
            if e["target"] in self.nodes:
                self.nodes[e["target"]]["degree"] += 1

    # ---- queries ---------------------------------------------------------
    def graph(self):
        return {
            "nodes": list(self.nodes.values()),
            "edges": self.edges,
            "source": data.source_label(),
        }

    def type_counts(self):
        counts = {}
        for n in self.nodes.values():
            counts[n["type"]] = counts.get(n["type"], 0) + 1
        return dict(sorted(counts.items(), key=lambda x: -x[1]))

    def top_hubs(self, k=10):
        return sorted(self.nodes.values(), key=lambda n: -n["degree"])[:k]

    def search(self, query, limit=6):
        """Very small ranked search: term frequency across title+body."""
        q = query.lower().strip()
        terms = [t for t in re.split(r"\W+", q) if len(t) > 2]
        if not terms:
            return []
        scored = []
        for nid, blob in self._search_blob.items():
            score = 0
            for t in terms:
                score += blob.count(t)
                if t in self.nodes[nid]["label"].lower():
                    score += 5  # title hit weighs more
            if score:
                scored.append((score, nid))
        scored.sort(reverse=True)
        out = []
        for score, nid in scored[:limit]:
            n = self.nodes[nid]
            out.append({
                "id": nid, "label": n["label"], "type": n["type"],
                "score": score, "excerpt": n["excerpt"], "path": n["path"],
            })
        return out

    def get(self, node_id):
        return self.nodes.get(node_id)

    def neighbors(self, node_id):
        out = []
        for e in self.edges:
            if e["source"] == node_id:
                out.append(e["target"])
            elif e["target"] == node_id:
                out.append(e["source"])
        return out

    def shortest_path(self, a, b):
        if a not in self.nodes or b not in self.nodes:
            return []
        from collections import deque
        q = deque([[a]])
        seen = {a}
        while q:
            path = q.popleft()
            if path[-1] == b:
                return path
            for nb in self.neighbors(path[-1]):
                if nb not in seen:
                    seen.add(nb)
                    q.append(path + [nb])
        return []


if __name__ == "__main__":
    v = Vault().build()
    print(f"source: {data.source_label()}   nodes: {len(v.nodes)}   edges: {len(v.edges)}")
    print("\ncounts by type:")
    for t, c in v.type_counts().items():
        print(f"  {t:10s} {c}")
    print("\ntop 10 hubs:")
    for n in v.top_hubs(10):
        print(f"  {n['degree']:3d}  {n['label']}  ({n['type']})")
    if v.warnings:
        print("\nwarnings:")
        for w in v.warnings:
            print("  " + w)
