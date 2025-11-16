"""
Enrich movies that are missing runtime or content rating.
Uses TMDB /movie/{id} endpoint.

Run:
    python backend/scripts/enrich_missing_movie_details.py
"""

import os
import asyncio
import httpx
from dotenv import load_dotenv
from supabase import create_client, Client
import time

# ------------------------------------------------
# LOAD ENV + CLIENTS
# ------------------------------------------------
load_dotenv()

TMDB_API_KEY = os.getenv("TMDB_API_KEY")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not TMDB_API_KEY or not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
    raise Exception("Missing required environment variables")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


# ------------------------------------------------
# TMDB DETAIL FETCH
# ------------------------------------------------
async def fetch_tmdb_details(tmdb_id: int):
    url = f"https://api.themoviedb.org/3/movie/{tmdb_id}"
    params = {"api_key": TMDB_API_KEY, "append_to_response": "release_dates"}

    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(url, params=params)
        if r.status_code != 200:
            print(f"❌ TMDB returned {r.status_code} for id {tmdb_id}")
            return None
        return r.json()


def extract_us_certification(details: dict):
    """Extract the US MPAA rating from release_dates."""
    results = details.get("release_dates", {}).get("results", [])
    for entry in results:
        if entry.get("iso_3166_1") == "US":
            dates = entry.get("release_dates", [])
            for d in dates:
                cert = d.get("certification")
                if cert:
                    return cert
    return None


# ------------------------------------------------
# MAIN ENRICHMENT LOGIC
# ------------------------------------------------
async def enrich():
    print("🔎 Fetching movies missing runtime or content_rating...")

    resp = supabase.table("movies") \
        .select("id, runtime_minutes, content_rating, external_ids") \
        .execute()

    rows = resp.data

    print(f"📦 Loaded {len(rows)} movies from Supabase")

    # Filter only missing fields
    missing = []
    for row in rows:
        if (
            row.get("runtime_minutes") is None
            or row.get("content_rating") is None
        ):
            tmdb_id = row["external_ids"].get("tmdb")
            if tmdb_id:
                missing.append(row)

    print(f"➡️ {len(missing)} movies need enrichment")

    # Process in chunks to be respectful of rate limits
    CHUNK = 40  # safe, TMDB limit is ~40 req/10 sec
    for i in range(0, len(missing), CHUNK):
        chunk = missing[i:i+CHUNK]
        print(f"\n⏳ Processing {len(chunk)} movies [{i}–{i+len(chunk)}]...")

        updates = []

        for movie in chunk:
            tmdb_id = movie["external_ids"]["tmdb"]
            details = await fetch_tmdb_details(tmdb_id)
            if not details:
                continue

            runtime = details.get("runtime")

            # Fix invalid runtimes
            if runtime is None or runtime <= 0:
                runtime = None

            certification = extract_us_certification(details)

            # Skip useless updates
            if runtime is None and certification is None:
                continue

            updates.append({
                "id": movie["id"],
                "runtime_minutes": runtime,
                "content_rating": certification
            })

        if updates:
            for row in updates:
                supabase.table("movies").update({
                    "runtime_minutes": row["runtime_minutes"],
                    "content_rating": row["content_rating"],
                }).match({"id": row["id"]}).execute()
            print(f"✅ Updated {len(updates)} movies")

        # TMDB rate limit safety sleep
        print("😴 Sleeping 3 seconds to avoid rate limit...")
        time.sleep(3)

    print("\n🎉 DONE — enrichment complete!")


if __name__ == "__main__":
    asyncio.run(enrich())