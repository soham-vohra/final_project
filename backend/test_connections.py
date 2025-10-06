from pathlib import Path
import os
from dotenv import load_dotenv
from supabase import create_client, Client
from datetime import datetime
import uuid

# Load your Supabase credentials
ROOT_ENV = Path(__file__).resolve().parents[1] / ".env"
load_dotenv(ROOT_ENV)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")

# Initialize the Supabase client
supabase: Client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)

print("Testing Supabase Connection...")
print("=" * 50)

# Try reading from the 'movies' table
try:
    response = supabase.table("movies").select("*").execute()
    data = response.data or []
    print(f"✅ Connected successfully. Found {len(data)} movies.\n")
except Exception as e:
    print(f"❌ Error reading 'profiles' table: {e}")

# Test adding to 'users' table, should throw an RLS error at the end
try:
    test_data = {
        "user_id": "c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a31",
        "display_name": "Bob Johnson",
        "avatar_url": "image.txt",
        "settings": {},
        "created_at": "2025-10-05 22:51:51.692136+00",
        "watchlist_movie_ids": []
    }
    
    response = supabase.table('profiles').insert(test_data).execute()
    print(f"✅ Successfully inserted data!")
    print(f"📝 Inserted record ID: {response.data[0]['id']}\n")
except Exception as e:
    print(f"❌ Error inserting data: {e}\n")
    print(f"Row level security ✅ \n")

# Test adding new "Source" Fandango to 'sources' table, should succeed (Insert RLS currently set to All)
try:
    fandango_uuid = str(uuid.uuid4())
    test_data = {
        "id": fandango_uuid,
        "name": "Fandango",
        "scale": "5",
        "base_url": "https://fandango.com"
    }
    
    response = supabase.table('sources').insert(test_data).execute()
    print(f"✅ Successfully inserted data!")
    print(f"📝 Inserted record ID: {response.data[0]['id']}\n")
except Exception as e:
    print(f"❌ Error inserting data: {e}\n")
    print(f"Row level security ✅ \n")


# Testing joining Source, Source Rating, and Movie table in order to have an aggregate table with movies
# and ratings across sources

try:
    sources = supabase.table("sources").select("*").execute().data or []
    ratings = supabase.table("source_ratings").select("*").execute().data or []
    movies  = supabase.table("movies").select("*").execute().data or []
except Exception as e:
    print("❌ Error fetching tables:", e)
print(f"Fetched {len(sources)} sources, {len(ratings)} ratings, {len(movies)} movies")

joined = []
for rating in ratings:
    src = next((s for s in sources if s["id"] == rating["source_id"]), None)
    mov = next((m for m in movies  if m["id"] == rating["movie_id"]), None)

    if src and mov:
        joined.append({
            "movie_title": mov.get("title"),
            "movie_id": mov.get("id"),
            "source_name": src.get("name"),
            "source_scale": src.get("scale"),
            "rating_value": rating.get("rating"),
            "created_at": rating.get("created_at"),
        })

print(f"\n✅ Joined {len(joined)} combined rows.\n")

for row in joined[:5]:
    print(row)

if not joined:
    print("\n⚠️ No joined rows found. Check that your source_ratings table has valid source_id and movie_id values.")
