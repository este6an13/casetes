"""
Music service — Deezer API integration.

Fetches track metadata from Deezer's public API and downloads cover art.
"""

import httpx
import time
import asyncio
from pathlib import Path


DEEZER_API_BASE = "https://api.deezer.com"
COVERS_DIR = Path("data/covers")

class RateLimiter:
    """Enforces a limit of exactly max_requests per window_seconds."""
    def __init__(self, max_requests: int, window_seconds: float):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.request_timestamps = []
        self._lock = asyncio.Lock()

    async def acquire(self):
        async with self._lock:
            while True:
                now = time.time()
                # Remove timestamps older than the window
                self.request_timestamps = [t for t in self.request_timestamps if now - t < self.window_seconds]
                
                if len(self.request_timestamps) < self.max_requests:
                    self.request_timestamps.append(now)
                    return
                
                # If we're at the limit, sleep until the oldest request falls out of the window
                oldest = self.request_timestamps[0]
                sleep_time = self.window_seconds - (now - oldest)
                if sleep_time > 0:
                    await asyncio.sleep(sleep_time)

# 50 requests per 300 seconds (5 minutes)
deezer_limiter = RateLimiter(max_requests=50, window_seconds=300)


async def get_deezer_track(deezer_id: str) -> dict | None:
    """
    Fetch track metadata from Deezer.

    Returns a dict with: title, artist, album, release_year, cover_url, deezer_id
    or None if the track wasn't found.
    """
    url = f"{DEEZER_API_BASE}/track/{deezer_id}"
    await deezer_limiter.acquire()
    
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
        "cover_url": data.get("album", {}).get("cover_medium")
                     or data.get("album", {}).get("cover_big")
                     or data.get("album", {}).get("cover_xl", ""),
        "duration": data.get("duration", 0),
        "preview_url": data.get("preview", ""),
        "isrc": data.get("isrc"),
    }


async def download_cover(cover_url: str, deezer_id: str) -> tuple[str | None, list[int] | None]:
    """
    Download cover art and save to data/covers/.
    Returns (relative_path, [h, s, l]) or (None, None) on failure.
    """
    if not cover_url:
        return None, None

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
                color = _compute_cover_color(filepath)
                return f"covers/{filename}", color
    except Exception as e:
        print(f"Error downloading cover: {e}")

    return None, None


def _compute_cover_color(image_path: Path) -> list[int] | None:
    """Compute average color of an image as [h, s, l]."""
    try:
        from PIL import Image
        img = Image.open(image_path).convert("RGB")
        img = img.resize((1, 1), Image.Resampling.LANCZOS)
        r, g, b = img.getpixel((0, 0))

        # RGB to HSL
        r2, g2, b2 = r / 255.0, g / 255.0, b / 255.0
        mx = max(r2, g2, b2)
        mn = min(r2, g2, b2)
        l = (mx + mn) / 2.0

        if mx == mn:
            h = s = 0.0
        else:
            d = mx - mn
            s = d / (2.0 - mx - mn) if l > 0.5 else d / (mx + mn)
            if mx == r2:
                h = (g2 - b2) / d + (6.0 if g2 < b2 else 0.0)
            elif mx == g2:
                h = (b2 - r2) / d + 2.0
            else:
                h = (r2 - g2) / d + 4.0
            h /= 6.0

        return [round(h * 360), round(s * 100), round(l * 100)]
    except Exception:
        return None


