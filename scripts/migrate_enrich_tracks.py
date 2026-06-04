import asyncio
import json
import sys
import sys
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
from pathlib import Path

# Add parent directory to path so we can import app modules
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.music_service import get_deezer_track, get_deezer_album, download_artist_picture

LIBRARY_FILE = Path(__file__).resolve().parent.parent / "data" / "library.json"

async def main():
    if not LIBRARY_FILE.exists():
        print("Library file not found.")
        return

    with open(LIBRARY_FILE, "r", encoding="utf-8") as f:
        library = json.load(f)

    album_cache = {}
    modified = False

    total = len(library)
    for i, track in enumerate(library):
        deezer_id = str(track.get("deezer_id", ""))
        
        # Skip manual tracks
        if deezer_id.startswith("manual_"):
            continue
            
        # Check if already enriched and using local paths
        needs_processing = True
        if "contributors" in track and "genres" in track and "artist_picture" in track:
            needs_processing = False
            if track.get("artist_picture", "").startswith("http"):
                needs_processing = True
            for c in track.get("contributors", []):
                if c.get("picture_medium", "").startswith("http"):
                    needs_processing = True
                    
        if not needs_processing:
            continue
            
        try:
            print(f"[{i+1}/{total}] Processing '{track.get('title')}' by {track.get('artist')}...")
        except UnicodeEncodeError:
            print(f"[{i+1}/{total}] Processing track ID {deezer_id}...")
        
        track_data = await get_deezer_track(deezer_id)
        if not track_data:
            print(f"  -> Failed to fetch track data for {deezer_id}")
            continue
            
        track["contributors"] = track_data.get("contributors", [])
        track["artist_picture"] = track_data.get("artist_picture", "")
        
        artist_id = track_data.get("artist_id")
        if track["artist_picture"] and artist_id:
            local_path = await download_artist_picture(track["artist_picture"], artist_id)
            if local_path:
                track["artist_picture"] = local_path
                
        for c in track["contributors"]:
            if c.get("picture_medium") and c.get("id"):
                local_path = await download_artist_picture(c["picture_medium"], c["id"])
                if local_path:
                    c["picture_medium"] = local_path
        
        album_id = track_data.get("album_id")
        genres = []
        if album_id:
            if album_id not in album_cache:
                album_data = await get_deezer_album(album_id)
                if album_data:
                    album_cache[album_id] = album_data.get("genres", [])
                else:
                    album_cache[album_id] = []
            genres = album_cache[album_id]
            
        track["genres"] = genres
        modified = True
        
        # Write after each successful enrichment for crash safety
        with open(LIBRARY_FILE, "w", encoding="utf-8") as f:
            json.dump(library, f, indent=2, ensure_ascii=False)
            
        print(f"  -> Enriched! Genres: {', '.join(genres) if genres else 'None'}, {len(track['contributors'])} contributors")

    if modified:
        print("Migration complete.")
    else:
        print("Nothing to migrate.")

if __name__ == "__main__":
    asyncio.run(main())
