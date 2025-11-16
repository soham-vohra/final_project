import os
import uuid
import asyncio
import httpx
from supabase import create_client, Client
from dotenv import load_dotenv

# ------------------------------------------------
# LOAD ENV + CLIENTS
# ------------------------------------------------
load_dotenv()

TMDB_API_KEY = os.getenv("TMDB_API_KEY")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not TMDB_API_KEY:
    raise Exception("TMDB_API_KEY missing in env")

if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
    raise Exception("Supabase env vars missing")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


# ------------------------------------------------
# TMDB HELPERS
# ------------------------------------------------
async def fetch_discover_page(page: int, sort_by: str):
    url = "https://api.themoviedb.org/3/discover/movie"
    params = {
        "api_key": TMDB_API_KEY,
        "page": page,
        "sort_by": sort_by,
        "include_adult": False,
    }

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(url, params=params)
        resp.raise_for_status()
        return resp.json().get("results", [])


async def fetch_many(pages: int, sort_by: str):
    results = []
    for p in range(1, pages + 1):
        print(f"[TMDB] {sort_by} – page {p}/{pages}")
        batch = await fetch_discover_page(p, sort_by)
        if not batch:
            break
        results.extend(batch)
    return results


# ------------------------------------------------
# MAPPING TO YOUR MOVIE SCHEMA
# ------------------------------------------------
def map_tmdb_to_supabase(movie: dict):
    release_year = None
    if movie.get("release_date"):
        try:
            release_year = int(movie["release_date"][:4])
        except:
            release_year = None

    poster_url = (
        f"https://image.tmdb.org/t/p/original{movie['poster_path']}"
        if movie.get("poster_path")
        else None
    )

    return {
        "id": str(uuid.uuid4()),
        "title": movie.get("title"),
        "release_year": release_year,
        "runtime_minutes": None,
        "content_rating": None,
        "poster_url": poster_url,
        "synopsis": movie.get("overview"),
        "external_ids": {"tmdb": movie.get("id")},
    }


# ------------------------------------------------
# MAIN INGEST
# ------------------------------------------------
async def ingest():
    print("🚀 Starting TMDB → Supabase quick ingest...")

    # pull several lists for variety
    raw_batches = await asyncio.gather(
        fetch_many(40, "popularity.desc"),
        fetch_many(20, "vote_count.desc"),
        fetch_many(20, "primary_release_date.desc")
    )

    # flatten
    raw = [m for b in raw_batches for m in b]

    # dedupe by TMDB id
    deduped = {movie["id"]: movie for movie in raw}
    movies = list(deduped.values())

    print(f"✨ Fetched {len(movies)} unique movies")

    supabase_payload = [map_tmdb_to_supabase(m) for m in movies]

    # insert in chunks
    CHUNK = 200
    for i in range(0, len(supabase_payload), CHUNK):
        chunk = supabase_payload[i:i+CHUNK]
        print(f"📦 Inserting {len(chunk)} movies... [{i}–{i+len(chunk)}]")
        supabase.table("movies").insert(chunk).execute()

    print("🎉 DONE — movies inserted into Supabase!")


if __name__ == "__main__":
    asyncio.run(ingest())