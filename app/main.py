"""
Music Library — FastAPI application.

Routes:
  GET  /         → library page (all tracks as embedded JSON)
  GET  /add      → add song page
  POST /add      → fetch Deezer metadata, download cover, store in JSON
  POST /api/fetch-track  → preview a Deezer track (returns metadata without saving)
  DELETE /track/{deezer_id}  → remove a track
  PATCH  /track/{deezer_id}/tags → update tags
"""

import json
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, Request, HTTPException
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, Response
import csv
import io
import openpyxl
from pydantic import BaseModel

from .music_service import get_deezer_track, download_cover

app = FastAPI(title="Music Library")

# --- Static files & templates ---
app.mount("/static", StaticFiles(directory="static"), name="static")
# Serve cover images from data/covers
DATA_DIR = Path("data")
COVERS_DIR = DATA_DIR / "covers"
LIBRARY_FILE = DATA_DIR / "library.json"

templates = Jinja2Templates(directory="templates")


# --- Data helpers ---
def _ensure_data_dir():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    COVERS_DIR.mkdir(parents=True, exist_ok=True)
    if not LIBRARY_FILE.exists():
        LIBRARY_FILE.write_text("[]", encoding="utf-8")


def _read_library() -> list[dict]:
    _ensure_data_dir()
    try:
        return json.loads(LIBRARY_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, FileNotFoundError):
        return []


def _write_library(tracks: list[dict]):
    _ensure_data_dir()
    LIBRARY_FILE.write_text(json.dumps(tracks, indent=2, ensure_ascii=False), encoding="utf-8")


# --- Startup ---
@app.on_event("startup")
async def startup_event():
    _ensure_data_dir()


# --- Serve cover images ---
@app.on_event("startup")
async def mount_covers():
    """Mount covers directory after ensuring it exists."""
    _ensure_data_dir()
    app.mount("/covers", StaticFiles(directory=str(COVERS_DIR)), name="covers")


# --- Routes ---

@app.get("/", response_class=HTMLResponse)
async def library_page(request: Request):
    """Library page — serves all tracks as embedded JSON."""
    tracks = _read_library()
    tracks_json = json.dumps(tracks, ensure_ascii=False)
    return templates.TemplateResponse("library.html", {
        "request": request,
        "tracks_json": tracks_json,
    })


@app.get("/add", response_class=HTMLResponse)
async def add_page(request: Request):
    """Add song page."""
    return templates.TemplateResponse("add.html", {"request": request})


class FetchTrackRequest(BaseModel):
    deezer_id: str


@app.post("/api/fetch-track")
async def fetch_track_preview(body: FetchTrackRequest):
    """Fetch track metadata from Deezer without saving. Used for preview."""
    track = await get_deezer_track(body.deezer_id)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found on Deezer")
    return track


class AddTrackRequest(BaseModel):
    deezer_id: str
    tags: list[str] = []


@app.post("/api/add-track")
async def add_track(body: AddTrackRequest):
    """Fetch metadata from Deezer, download cover, and save to library."""
    library = _read_library()

    # Check for duplicates
    if any(t["deezer_id"] == body.deezer_id for t in library):
        raise HTTPException(status_code=409, detail="Track already in library")

    # Fetch metadata
    track = await get_deezer_track(body.deezer_id)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found on Deezer")

    # Download cover
    cover_path = await download_cover(track["cover_url"], body.deezer_id)

    # Build track entry
    entry = {
        "deezer_id": track["deezer_id"],
        "title": track["title"],
        "artist": track["artist"],
        "album": track["album"],
        "release_year": track["release_year"],
        "cover": cover_path,
        "duration": track.get("duration", 0),
        "preview_url": track.get("preview_url", ""),
        "tags": [t.strip() for t in body.tags if t.strip()],
        "added_at": datetime.utcnow().isoformat(),
    }

    library.append(entry)
    _write_library(library)

    return {"message": "success", "track": entry}


@app.delete("/api/track/{deezer_id}")
async def delete_track(deezer_id: str):
    """Remove a track from the library."""
    library = _read_library()
    new_library = [t for t in library if t["deezer_id"] != deezer_id]

    if len(new_library) == len(library):
        raise HTTPException(status_code=404, detail="Track not found")

    # Delete cover file if it exists
    removed = [t for t in library if t["deezer_id"] == deezer_id]
    for t in removed:
        if t.get("cover"):
            cover_path = DATA_DIR / t["cover"]
            if cover_path.exists():
                cover_path.unlink()

    _write_library(new_library)
    return {"message": "deleted"}


class UpdateTagsRequest(BaseModel):
    tags: list[str]


@app.patch("/api/track/{deezer_id}/tags")
async def update_tags(deezer_id: str, body: UpdateTagsRequest):
    """Update tags for a track."""
    library = _read_library()
    found = False
    for track in library:
        if track["deezer_id"] == deezer_id:
            track["tags"] = [t.strip() for t in body.tags if t.strip()]
            found = True
            break

    if not found:
        raise HTTPException(status_code=404, detail="Track not found")

    _write_library(library)
    return {"message": "tags updated", "tags": library[0]["tags"] if library else []}


@app.get("/api/export/{fmt}")
async def export_library(fmt: str):
    """Export the music library to CSV, JSON, or XLSX."""
    library = _read_library()
    
    timestamp = datetime.now().strftime("%y%m%d-%H%M%S")
    filename = f"music-library-data-{timestamp}.{fmt}"

    if fmt == "json":
        # Stripping out internal paths like 'cover' before exporting
        export_data = [{k: v for k, v in track.items() if k != 'cover'} for track in library]
        content = json.dumps(export_data, indent=2, ensure_ascii=False)
        return Response(
            content=content,
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'}
        )
        
    # Prepare flat data for CSV and XLSX
    headers = ["Title", "Artist", "Album", "Year", "Duration (s)", "Tags", "Deezer ID", "ISRC"]
    rows = []
    for track in library:
        rows.append([
            track.get("title", ""),
            track.get("artist", ""),
            track.get("album", ""),
            track.get("release_year", ""),
            track.get("duration", 0),
            ", ".join(track.get("tags", [])),
            track.get("deezer_id", ""),
            track.get("isrc", "")
        ])

    if fmt == "csv":
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(headers)
        writer.writerows(rows)
        return Response(
            content=output.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'}
        )
        
    if fmt == "xlsx":
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Music Library"
        ws.append(headers)
        for row in rows:
            ws.append(row)
        
        output = io.BytesIO()
        wb.save(output)
        return Response(
            content=output.getvalue(),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'}
        )

    raise HTTPException(status_code=400, detail="Invalid format. Supported: json, csv, xlsx")
