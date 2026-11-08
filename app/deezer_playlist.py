"""
Deezer playlist mirror — keeps a Deezer playlist in step with the library.

Writing to a playlist needs an OAuth token from a Deezer developer app:
  DEEZER_APP_ID, DEEZER_APP_SECRET  → the app (developers.deezer.com/myapps)
  DEEZER_PLAYLIST_ID                → the playlist to mirror into
  DEEZER_ACCESS_TOKEN               → saved to .env by the one-time connect flow

The connect flow asks for offline_access, so the token doesn't expire.
"""

import os
from pathlib import Path
from urllib.parse import urlencode

import httpx

from .music_service import DEEZER_API_BASE, deezer_limiter

CONNECT_BASE = "https://connect.deezer.com/oauth"
PERMISSIONS = "basic_access,manage_library,delete_library,offline_access"
ENV_FILE = Path(".env")

BATCH_SIZE = 50
PAGE_SIZE = 100

# Exact-mirror safety brake: refuse to remove more than this share of the
# playlist in one sync (unless it's only a handful of songs), so a broken or
# partial library file can't wipe it.
MAX_REMOVE_SHARE = 0.5
SMALL_REMOVAL = 20


class DeezerError(Exception):
    pass


def settings() -> dict:
    return {
        "app_id": os.getenv("DEEZER_APP_ID", ""),
        "app_secret": os.getenv("DEEZER_APP_SECRET", ""),
        "playlist_id": os.getenv("DEEZER_PLAYLIST_ID", ""),
        "token": os.getenv("DEEZER_ACCESS_TOKEN", ""),
    }


# --- One-time connect (OAuth) ---


def auth_url(redirect_uri: str) -> str:
    s = settings()
    if not s["app_id"]:
        raise DeezerError("DEEZER_APP_ID is not set in .env")
    query = urlencode({"app_id": s["app_id"], "redirect_uri": redirect_uri, "perms": PERMISSIONS})
    return f"{CONNECT_BASE}/auth.php?{query}"


async def exchange_code(code: str) -> str:
    """Trade the code from Deezer's redirect for an access token."""
    s = settings()
    if not s["app_id"] or not s["app_secret"]:
        raise DeezerError("DEEZER_APP_ID and DEEZER_APP_SECRET must be set in .env")

    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{CONNECT_BASE}/access_token.php",
            params={"app_id": s["app_id"], "secret": s["app_secret"], "code": code, "output": "json"},
        )
    try:
        token = resp.json().get("access_token")
    except ValueError:
        token = None
    if not token:
        raise DeezerError(f"Deezer didn't return a token: {resp.text[:200]}")
    return token


def save_token(token: str):
    """Store the token in .env (and the running process) so syncs can use it."""
    lines = ENV_FILE.read_text(encoding="utf-8").splitlines() if ENV_FILE.exists() else []
    lines = [line for line in lines if not line.startswith("DEEZER_ACCESS_TOKEN=")]
    lines.append(f"DEEZER_ACCESS_TOKEN={token}")
    ENV_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")
    os.environ["DEEZER_ACCESS_TOKEN"] = token


# --- API calls ---


async def _call(client: httpx.AsyncClient, method: str, path: str, **params):
    """Call the Deezer API; it reports most errors as 200 + {"error": ...}."""
    await deezer_limiter.acquire()
    resp = await client.request(method, f"{DEEZER_API_BASE}{path}", params=params)
    try:
        data = resp.json()
    except ValueError:
        raise DeezerError(f"Unexpected response ({resp.status_code}) from {path}")
    if isinstance(data, dict) and "error" in data:
        err = data["error"]
        raise DeezerError(f"{err.get('message', 'unknown error')} (code {err.get('code')})")
    return data


async def _playlist_track_ids(client, playlist_id: str, token: str) -> list[str]:
    ids, index = [], 0
    while True:
        page = await _call(
            client, "GET", f"/playlist/{playlist_id}/tracks",
            access_token=token, index=index, limit=PAGE_SIZE,
        )
        ids.extend(str(t["id"]) for t in page.get("data", []))
        if not page.get("next"):
            return ids
        index += PAGE_SIZE


async def _change_tracks(client, method: str, playlist_id: str, token: str, ids: list[str]):
    """Add (POST) or remove (DELETE) songs in batches. A batch Deezer rejects
    is retried one song at a time, so one bad id (e.g. a track Deezer no
    longer has) doesn't block the rest. Returns (done, failed) id lists."""
    done, failed = [], []
    for i in range(0, len(ids), BATCH_SIZE):
        batch = ids[i:i + BATCH_SIZE]
        try:
            await _call(client, method, f"/playlist/{playlist_id}/tracks", access_token=token, songs=",".join(batch))
            done.extend(batch)
        except DeezerError:
            for song in batch:
                try:
                    await _call(client, method, f"/playlist/{playlist_id}/tracks", access_token=token, songs=song)
                    done.append(song)
                except DeezerError:
                    failed.append(song)
    return done, failed


# --- Mirror ---


async def mirror_playlist(library_ids: list[str]) -> str:
    """Make the playlist match the library's Deezer songs. Returns a summary
    line for the sync message."""
    s = settings()
    if not s["app_id"] or not s["playlist_id"]:
        return "Deezer playlist: not set up (add DEEZER_APP_ID, DEEZER_APP_SECRET and DEEZER_PLAYLIST_ID to .env)"
    if not s["token"]:
        return "Deezer playlist: not connected yet (open /api/deezer/login once)"

    wanted = [i for i in dict.fromkeys(library_ids) if i.isdigit()]
    if not wanted:
        return "Deezer playlist: skipped, the library has no Deezer songs"

    async with httpx.AsyncClient(timeout=30) as client:
        current = await _playlist_track_ids(client, s["playlist_id"], s["token"])
        current_set, wanted_set = set(current), set(wanted)

        to_add = [i for i in wanted if i not in current_set]
        to_remove = [i for i in dict.fromkeys(current) if i not in wanted_set]

        removal_note = ""
        if len(to_remove) > SMALL_REMOVAL and len(to_remove) > MAX_REMOVE_SHARE * len(current):
            removal_note = f", skipped removing {len(to_remove)} (more than half the playlist; check the library first)"
            to_remove = []

        added, add_failed = await _change_tracks(client, "POST", s["playlist_id"], s["token"], to_add)
        removed, remove_failed = await _change_tracks(client, "DELETE", s["playlist_id"], s["token"], to_remove)

    summary = f"Deezer playlist: +{len(added)} added, -{len(removed)} removed"
    if add_failed:
        summary += f", {len(add_failed)} couldn't be added ({', '.join(add_failed[:5])}{'…' if len(add_failed) > 5 else ''})"
    if remove_failed:
        summary += f", {len(remove_failed)} couldn't be removed"
    return summary + removal_note
