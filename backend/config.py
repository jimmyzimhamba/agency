import os
import json
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).parent.parent
DATA_DIR = BASE_DIR / "data"
DB_PATH = DATA_DIR / "studio_x.db"
SETTINGS_PATH = DATA_DIR / "settings.json"

GOOGLE_MAPS_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY", "")
DEFAULT_CITY = os.getenv("DEFAULT_CITY", "Harare")

USER_AGENT = "StudioXLeadCenter/1.0 (internal business tool; contact@studioxmarketing.com)"
REQUEST_TIMEOUT = 10
ENRICHMENT_RATE_LIMIT_SECONDS = 1.5


def load_settings() -> dict:
    if SETTINGS_PATH.exists():
        with open(SETTINGS_PATH) as f:
            return json.load(f)
    return {}


def save_settings(data: dict):
    with open(SETTINGS_PATH, "w") as f:
        json.dump(data, f, indent=2)
