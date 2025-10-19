from fastapi import FastAPI, HTTPException
from supabase import create_client, Client
import os
from dotenv import load_dotenv
import uuid

load_dotenv()

SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")
SUPABASE_URL = os.getenv("SUPABASE_URL", "")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)

app = FastAPI(title = "CineSync API")

@app.get("/")
def root():
    return {"status": "ok"}

@app.get("/movies")
def get_movies():
    try:
        result = supabase.table("movies").select("*").execute()
        return result.data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# POST /movies endpoint accepts limited parameters, ingestion pipeline will fill other parameters
@app.post("/movies")
def add_movie(title: str, release_year: int, runtime_minutes: int, content_rating: str, poster_url: str):
    existing_movies = supabase.table("movies").select("id, title, release_year, runtime_minutes")\
        .eq("title", title)\
        .eq("runtime_minutes", runtime_minutes)\
        .eq("release_year", release_year)\
        .execute()
    if existing_movies.data and len(existing_movies.data) > 0: # type: ignore
        raise HTTPException(status_code=400, detail="Movie already exists in DB.")
    try:
        result = supabase.table("movies").insert({
            "title": title,
            "release_year": release_year,
            "runtime_minutes": runtime_minutes,
            "content_rating": content_rating,
            "poster_url": poster_url
        }).execute()
        return result.data[0] # type: ignore
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
# POST /watch_history endpoint adds new movie to user's watch history
# Allows duplicates to track rewatches
@app.post("/watch_history")
def add_watched_movie(user_id: str, movie_id: str):
    try:
        result = supabase.table("watch_history").insert({
            "user_id": user_id,
            "movie_id": movie_id
        }).execute() # type: ignore
        return result.data[0] # type: ignore
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
# GET /watch_history/count_rewatches returns count, user id, and movie id of rewatches   
@app.get("/watch_history/count_rewatches")
def count_user_rewatches(user_id: str, movie_id: str):
    try:
        result = supabase.table("watch_history").select("id", count="exact")\
            .eq("user_id", user_id)\
            .eq("movie_id", movie_id)\
            .execute()
        return {
            "count": result.count or 0, 
            "user_id": user_id,
            "movie_id": movie_id,
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))