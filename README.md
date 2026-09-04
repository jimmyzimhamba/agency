# Studio X Lead Command Center

A private, local prospecting + leads + outreach command center for Studio X Marketing.
Find business leads, audit their weaknesses, and reach out in one tap.

---

## Quick Start

### 1. Prerequisites
- Python 3.10 or newer
- pip

### 2. Clone / navigate to the project folder
```bash
cd "Studio X Lead Command Center"
```

### 3. Create and activate a virtual environment
```bash
python3 -m venv venv
source venv/bin/activate        # Mac/Linux
# venv\Scripts\activate          # Windows
```

### 4. Install dependencies
```bash
pip install -r requirements.txt
```

### 5. Set up your environment file
```bash
cp .env.example .env
```
Open `.env` and add your Google Maps API key (see below). The app runs in **manual mode** without the key — you can add prospects by hand and the audit still runs.

### 6. Run the server
```bash
python -m uvicorn backend.main:app --reload --port 8000
```

### 7. Open in browser / phone
```
http://localhost:8000
```
On your phone (same WiFi): `http://<your-mac-ip>:8000`

---

## Google Maps API Key

Enables: **lead discovery** (Places API) and **map view** (Maps JavaScript API).

### Steps
1. Go to [console.cloud.google.com](https://console.cloud.google.com/)
2. Create a project (or open an existing one)
3. Enable these two APIs:
   - **Maps JavaScript API**
   - **Places API (New)**
4. Go to **Credentials** → **Create Credentials** → **API Key**
5. (Recommended) Restrict the key to your IP and the two APIs above
6. Add to `.env`:
   ```
   GOOGLE_MAPS_API_KEY=AIzaSy...your_key_here
   ```
7. Restart the server

### Billing note
Google Maps Platform requires a billing account. The free tier gives $200/month credit — more than enough for typical prospecting use. Discovery runs ~20 requests per niche search.

---

## Adding a New Niche

Edit `data/settings.json`. Add an entry to the `niches` array:

```json
{
  "id": "private_schools",
  "label": "Private Schools",
  "icon": "🎓",
  "description": "K-12 private schools, tutoring centres, colleges",
  "queries": [
    "private school Harare",
    "tutoring centre",
    "international school Zimbabwe"
  ],
  "service_angles": {
    "no_website": "Parents research schools online before enquiring — no site means missed enrolments.",
    "no_instagram": "School life content on Instagram is exactly what parents and prospective students check.",
    "no_whatsapp": "WhatsApp is how parents communicate with schools in Zimbabwe.",
    "low_reviews": "Schools live or die on reputation — Google reviews are the first thing parents check.",
    "stale_social": "An inactive page signals a school that doesn't communicate. Parents notice."
  }
}
```

Restart the server. The new niche appears automatically in the UI.

---

## Data

- Database: `data/studio_x.db` (SQLite — back this file up regularly)
- Settings: `data/settings.json`
- No data leaves your machine. Discovery uses the Google Places API. Enrichment fetches each business's own public website.

---

## Legitimacy Guardrails

- Discovery: official Google Places API only. No scraping.
- Enrichment: reads each business's own public homepage. Respects `robots.txt`. 1.5s rate limit between requests. 10s timeout.
- Only publicly published business contact info is stored.
- User-agent is clearly identified as `StudioXLeadCenter/1.0`.

---

## File Structure

```
├── backend/
│   ├── main.py              FastAPI app + static file serving
│   ├── database.py          SQLite engine + session
│   ├── models.py            ORM models (Prospect, OutreachLog)
│   ├── schemas.py           Pydantic request/response schemas
│   ├── config.py            Env + settings loader
│   ├── routers/
│   │   ├── prospects.py     CRUD, import, map pins
│   │   ├── discovery.py     Places API search + progress
│   │   ├── outreach.py      Logging + content library
│   │   └── settings.py      Settings read/write
│   └── services/
│       ├── enrichment.py    Website audit + weakness detection
│       ├── scoring.py       HOT / WARM / COLD logic
│       ├── places.py        Google Places API wrapper
│       └── templates.py     Opening messages, objection counters
├── frontend/
│   ├── index.html           Single-page app shell
│   ├── css/styles.css       Afrofuturism design system
│   └── js/
│       ├── api.js           API client
│       ├── utils.js         Shared helpers
│       ├── app.js           Navigation + routing
│       ├── dashboard.js     Dashboard view
│       ├── discover.js      Find leads + manual add + CSV import
│       ├── table.js         Sortable/filterable list
│       ├── pipeline.js      Kanban board
│       ├── map-view.js      Google Maps + colored pins
│       ├── library.js       Content library
│       ├── settings-view.js Settings UI
│       └── prospect-modal.js  Prospect detail drawer
├── data/
│   ├── settings.json        Niches, queries, Studio X config
│   └── studio_x.db          SQLite database (auto-created)
├── requirements.txt
├── .env.example
└── README.md
```

---

## Definition of Done

Open on phone → pick niche + area → Find Leads → watch HOT leads populate → open any HOT lead → see recommended channel and why → tap one button → prefilled message ready to send. Add manually, import CSV, pull objection counters — all in one tap.
