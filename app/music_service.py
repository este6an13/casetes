"""
Music service — Deezer API integration.

Fetches track metadata from Deezer's public API and downloads cover art.
"""

import httpx
from pathlib import Path


DEEZER_API_BASE = "https://api.deezer.com"
COVERS_DIR = Path("data/covers")


async def get_deezer_track(deezer_id: str) -> dict | None:
    """
    Fetch track metadata from Deezer.

    Returns a dict with: title, artist, album, release_year, cover_url, deezer_id
    or None if the track wasn't found.
    """
    url = f"{DEEZER_API_BASE}/track/{deezer_id}"
    async with httpx.AsyncClient() as client:
        resp = await client.get(url)
        if resp.status_code != 200:
            return None
        data = resp.json()

    # Deezer returns {"error": {...}} for invalid IDs
    if "error" in data:
        return None

    # Extract release year from the album release date (format: "YYYY-MM-DD")
    release_date = data.get("release_date", "")
    release_year = None
    if release_date and len(release_date) >= 4:
        try:
            release_year = int(release_date[:4])
        except ValueError:
            pass

    return {
        "deezer_id": str(data["id"]),
        "title": data.get("title", "Unknown"),
        "artist": data.get("artist", {}).get("name", "Unknown"),
        "album": data.get("album", {}).get("title", "Unknown"),
        "release_year": release_year,
        "cover_url": data.get("album", {}).get("cover_xl")
                     or data.get("album", {}).get("cover_big")
                     or data.get("album", {}).get("cover_medium", ""),
        "duration": data.get("duration", 0),
        "preview_url": data.get("preview", ""),
    }


async def download_cover(cover_url: str, deezer_id: str) -> str | None:
    """
    Download cover art and save to data/covers/.
    Returns the relative path (e.g. "covers/123456.jpg") or None on failure.
    """
    if not cover_url:
        return None

    COVERS_DIR.mkdir(parents=True, exist_ok=True)

    # Determine extension from URL
    ext = ".jpg"
    if ".png" in cover_url.lower():
        ext = ".png"

    filename = f"{deezer_id}{ext}"
    filepath = COVERS_DIR / filename

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(cover_url)
            if resp.status_code == 200:
                filepath.write_bytes(resp.content)
                return f"covers/{filename}"
    except Exception as e:
        print(f"Error downloading cover: {e}")

    return None
