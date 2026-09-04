"""memory.py — writes to memory/ and nowhere else.

One dated markdown file per remembered fact. Never touches your source
folders. The caller must always say out loud what was written (guardrail).
"""
import os
import re
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
MEM_DIR = os.path.join(ROOT, "memory")


def _slug(text, n=6):
    words = re.findall(r"[a-z0-9]+", text.lower())
    return "-".join(words[:n]) or "note"


def write_fact(text: str) -> dict:
    """Write one fact to its own dated file. Returns the path + exact content."""
    os.makedirs(MEM_DIR, exist_ok=True)
    today = date.today().isoformat()
    base = f"{today}-{_slug(text)}"
    path = os.path.join(MEM_DIR, base + ".md")
    i = 2
    while os.path.exists(path):
        path = os.path.join(MEM_DIR, f"{base}-{i}.md")
        i += 1
    content = f"---\ndate: {today}\n---\n\n{text.strip()}\n"
    with open(path, "w") as f:
        f.write(content)
    return {"path": path, "file": os.path.basename(path), "text": text.strip(), "date": today}


def read_all() -> list:
    if not os.path.isdir(MEM_DIR):
        return []
    out = []
    for fn in sorted(os.listdir(MEM_DIR)):
        if not fn.endswith(".md"):
            continue
        with open(os.path.join(MEM_DIR, fn)) as f:
            txt = f.read()
        body = re.sub(r"^---.*?---", "", txt, count=1, flags=re.DOTALL).strip()
        out.append({"file": fn, "text": body})
    return out
