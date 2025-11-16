from fastapi import FastAPI, HTTPException
from supabase import create_client, Client
import os
from dotenv import load_dotenv
import uuid
from typing import Optional
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")
SUPABASE_URL = os.getenv("SUPABASE_URL", "")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)

app = FastAPI(title = "CineSync API")

# CORS configuration to allow React Native frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # You may replace "*" with your actual frontend origin later
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def root():
    return {"status": "ok"}

@app.get("/movies")
def get_movies(
    page: int = 1,
    page_size: int = 50,
    search: Optional[str] = None,
):
    """
    Get movies with simple pagination and optional search.

    Query params:
    - page: 1-based page index
    - page_size: number of items per page (max 100)
    - search: optional substring to match in the movie title
    """
    if page < 1:
        raise HTTPException(status_code=400, detail="page must be >= 1")
    if page_size < 1 or page_size > 100:
        raise HTTPException(status_code=400, detail="page_size must be between 1 and 100")

    try:
        query = supabase.table("movies").select("*", count="exact")

        # basic search on title
        if search:
            query = query.ilike("title", f"%{search}%")

        start = (page - 1) * page_size
        end = start + page_size - 1

        result = query.range(start, end).execute()

        return {
            "page": page,
            "page_size": page_size,
            "total": result.count or 0,
            "movies": result.data,
        }
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
    

@app.post("/user_rating")
def user_movie_rating(user_id: str, movie_id: str, rating: int, review: str):
    existing_rating = supabase.table("user_ratings").select("id, user_id, movie_id")\
        .eq("user_id", user_id)\
        .eq("movie_id", movie_id)\
        .execute()
    if existing_rating.data and len(existing_rating.data) > 0:
        raise HTTPException(status_code=400, detail="User has already rated this movie")
    try:
        res = supabase.table("user_ratings").insert({
            "user_id": user_id,
            "movie_id": movie_id,
            "rating": rating,
            "review": review
        }).execute()
        return res.data[0] #type: ignore
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))