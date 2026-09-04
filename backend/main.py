from pathlib import Path
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware

from backend.database import init_db
from backend.routers import prospects, discovery, outreach, settings as settings_router

app = FastAPI(title="Studio X Lead Command Center", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(prospects.router)
app.include_router(discovery.router)
app.include_router(outreach.router)
app.include_router(settings_router.router)

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"
app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")


@app.on_event("startup")
def startup():
    init_db()


@app.get("/", include_in_schema=False)
def serve_spa():
    return FileResponse(str(FRONTEND_DIR / "index.html"))


@app.get("/{full_path:path}", include_in_schema=False)
def catch_all(full_path: str):
    # Serve SPA for any non-API route
    if full_path.startswith("api/"):
        return {"detail": "Not Found"}
    return FileResponse(str(FRONTEND_DIR / "index.html"))
