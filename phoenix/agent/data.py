"""data.py — THE ONLY FILE THAT TOUCHES REAL DATA.

Reads exactly one switch (JARVIS_DEMO) and decides which folders Phoenix
indexes. Everything else in the codebase goes through here, so there is a
single place to audit what gets read.

  JARVIS_DEMO=1  (default)  -> invented demo fixtures, safe to screen-record
  JARVIS_DEMO=0             -> your real folders (edit REAL_FOLDERS below)

Nothing here ever writes. Indexing is read-only, always.
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)  # phoenix/

DEMO_VAULT = os.path.join(ROOT, "data", "vault_demo")

# --- YOUR REAL FOLDERS -----------------------------------------------------
# Only read when JARVIS_DEMO=0. Absolute paths. Read-only, recursive.
# Easiest way to set these: put them in .env as PHOENIX_REAL_FOLDERS, one or
# more absolute paths separated by a colon (:) — no Python edit needed, e.g.
#   PHOENIX_REAL_FOLDERS=/Users/you/Documents/Clients:/Users/you/Notes
# If that env var is empty, the hardcoded list below is used instead.
# Anything unreadable is skipped with a warning, not a crash.
REAL_FOLDERS = [
    # "/Users/kirmireelectronics/Documents/Clients",
    # "/Users/kirmireelectronics/Notes",
]


def is_demo() -> bool:
    return os.environ.get("JARVIS_DEMO", "1").strip() != "0"


def _configured_folders():
    """Folders from PHOENIX_REAL_FOLDERS (.env) if set, else REAL_FOLDERS."""
    env = os.environ.get("PHOENIX_REAL_FOLDERS", "").strip()
    if env:
        return [p.strip() for p in env.split(os.pathsep) if p.strip()]
    return list(REAL_FOLDERS)


def source_folders():
    """Return the list of root folders to index, honoring the demo switch."""
    if is_demo():
        return [DEMO_VAULT]
    return [os.path.abspath(p) for p in _configured_folders() if os.path.isdir(p)]


def source_label() -> str:
    return "DEMO" if is_demo() else "LIVE"
