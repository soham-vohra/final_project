from fastapi import FastAPI, HTTPException, Header
from supabase import create_client, Client
import os
from dotenv import load_dotenv
import uuid
from typing import Optional, List, Literal
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware

import requests
import math
from datetime import datetime
import logging

load_dotenv()

# Set up file logging
logging.basicConfig(
    filename='/tmp/cine_api_debug.log',
    level=logging.DEBUG,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
SUPABASE_URL = os.getenv("SUPABASE_URL", "")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

TMDB_API_KEY = os.getenv("TMDB_API_KEY", "")
TMDB_BASE_URL = "https://api.themoviedb.org/3"

INGESTION_SECRET = os.getenv("INGESTION_SECRET", "")


if not TMDB_API_KEY:
    # Warn in logs; the endpoint will fail if key is missing
    print("WARNING: TMDB_API_KEY is not set. Ingestion endpoint will not work.")

app = FastAPI(title = "CineSync API")

# CORS configuration to allow React Native frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # You may replace "*" with your actual frontend origin later
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class QuizAnswer(BaseModel):
    questionId: str
    choice: Literal["A", "B"]


class PreferencesPayload(BaseModel):
    user_id: str
    quizVersion: str
    answers: List[QuizAnswer]
    preferenceVector: List[float]


class PreferencesBatchPayload(BaseModel):
    user_ids: List[str]


# --- Watch and React payload model ---

class WatchAndReactPayload(BaseModel):
    user_id: str
    rating: int
    reaction: Literal["like", "meh", "dislike"]
    review: Optional[str] = None
    watched_at: Optional[datetime] = None

# --- Social graph payload models ---

class RelationshipRequestPayload(BaseModel):
    """
    Payload to initiate a follow / friend request.
    We keep semantics as:
    - user_id: the user initiating the request (follower)
    - target_user_id: the user being followed / requested
    """
    user_id: str
    target_user_id: str


class RelationshipRespondPayload(BaseModel):
    """
    Payload to respond to an existing relationship request.

    Only the target_user_id of a pending relationship may accept/reject it.
    """
    user_id: str
    relationship_id: str
    action: Literal["accept", "reject"]
# --- Search endpoint: on-demand TMDB ingestion + local search ---


# --- TMDB and vibe helpers ---

def tmdb_get(path: str, params: Optional[dict] = None) -> dict:
    """
    Basic helper to call TMDB API.
    """
    if not TMDB_API_KEY:
        raise RuntimeError("TMDB_API_KEY is not configured")

    if params is None:
        params = {}

    params = {**params, "api_key": TMDB_API_KEY}

    url = f"{TMDB_BASE_URL}{path}"
    resp = requests.get(url, params=params, timeout=15)
    resp.raise_for_status()
    return resp.json()


def extract_genre_ids(movie: dict) -> list[int]:
    """
    Normalize genre IDs from TMDB payloads.

    - Search / trending / popular results use 'genre_ids': [int, ...]
    - Movie detail responses use 'genres': [{id, name}, ...]
    """
    genre_ids = movie.get("genre_ids") or []
    if not genre_ids and movie.get("genres"):
        genre_ids = [g.get("id") for g in movie.get("genres") or [] if g.get("id") is not None]
    return genre_ids



# --- Movie vibe vector helpers (richer heuristic) ---

def _normalize_range(value: float, min_val: float, max_val: float) -> float:
    """
    Normalize a scalar into [-1, 1] given a min and max.
    Values outside the range are clipped.
    """
    if value is None:
        return 0.0
    if max_val == min_val:
        return 0.0
    v = (value - min_val) / (max_val - min_val)  # 0..1
    v = max(0.0, min(1.0, v))
    return v * 2.0 - 1.0  # -> -1..1


def _safe_year(release_date: Optional[str]) -> Optional[int]:
    if not release_date:
        return None
    try:
        return int(release_date.split("-")[0])
    except Exception:
        return None


def _safe_runtime(movie: dict) -> Optional[int]:
    runtime = movie.get("runtime")
    if runtime is None:
        # Some list endpoints don't include runtime; try a fallback field if you later add detail fetches.
        return None
    try:
        return int(runtime)
    except Exception:
        return None


def _keyword_score(text: str, positive_keywords: list[str], negative_keywords: list[str]) -> float:
    """
    Very lightweight keyword-based sentiment-ish scoring.
    Returns a value in [-1, 1] based on keyword hits.
    """
    if not text:
        return 0.0
    t = text.lower()
    pos_hits = sum(1 for k in positive_keywords if k in t)
    neg_hits = sum(1 for k in negative_keywords if k in t)
    total = pos_hits + neg_hits
    if total == 0:
        return 0.0
    raw = (pos_hits - neg_hits) / float(total)  # -1..1
    return max(-1.0, min(1.0, raw))


def compute_movie_vibe(movie: dict) -> list[float]:
    """
    Compute a 10D vibe vector for a TMDB movie payload.

    This version is more expressive and tries to use:
    - genres (including genre_ids from list/search and genres from detail)
    - popularity & vote_count
    - release year
    - runtime (if available)
    - overview text keywords

    Axes (aligned with the quiz):
    0: Mainstream vs Arthouse
    1: Light/Fun vs Dark/Serious
    2: Fast-paced vs Slow-burn
    3: Plot vs Character
    4: Action vs Dialogue
    5: Old vs New
    6: Realistic vs Fantastical
    7: Optimistic vs Bleak
    8: Short vs Epic
    9: Comfort vs Challenging
    """
    v = [0.0] * 10

    genre_ids = set(extract_genre_ids(movie))
    vote_count = movie.get("vote_count") or 0
    popularity = movie.get("popularity") or 0.0
    release_date = movie.get("release_date")
    overview = movie.get("overview") or ""
    runtime = _safe_runtime(movie)
    year = _safe_year(release_date)

    # -------------------------------
    # Axis 0: Mainstream vs Arthouse
    # -------------------------------
    # Use popularity and vote_count, scaled by rough expectations.
    # Highly popular, heavily rated titles lean mainstream (-1),
    # tiny, low-popularity titles lean arthouse (+1).
    pop_component = -_normalize_range(popularity, 0.0, 150.0)
    # Map log10(vote_count+1) roughly from 0..4 (1 to 10k votes)
    import math
    vc_log = math.log10(vote_count + 1) if vote_count > 0 else 0.0
    vc_component = -_normalize_range(vc_log, 0.0, 4.0)
    v[0] = 0.6 * pop_component + 0.4 * vc_component

    # -------------------------------
    # Axis 1: Light/Fun vs Dark/Serious
    # -------------------------------
    # Genres + overview keywords.
    light_keywords = ["fun", "funny", "heartwarming", "feel-good", "family", "uplifting", "romantic comedy"]
    dark_keywords = ["murder", "serial killer", "war", "brutal", "violent", "depressing", "dark", "gritty", "horror", "bleak"]

    keyword_component = _keyword_score(overview, light_keywords, dark_keywords)
    # Genre-based component: comedies/animations lean light, horror/war/crime lean dark.
    light_genres = {35, 16, 10751, 10402}         # Comedy, Animation, Family, Music
    dark_genres = {27, 80, 53, 10752}            # Horror, Crime, Thriller, War

    light_hits = len(genre_ids & light_genres)
    dark_hits = len(genre_ids & dark_genres)
    total_hits = light_hits + dark_hits
    if total_hits > 0:
        genre_raw = (light_hits - dark_hits) / float(total_hits)  # -1..1
    else:
        genre_raw = 0.0

    genre_component = max(-1.0, min(1.0, genre_raw))
    v[1] = 0.5 * keyword_component + 0.5 * genre_component

    # -------------------------------
    # Axis 2: Fast-paced vs Slow-burn
    # -------------------------------
    # Action/Thriller lean fast; long runtime and heavy drama lean slow.
    fast_genres = {28, 53, 12, 878}              # Action, Thriller, Adventure, Sci-Fi
    slow_genres = {18, 36, 10749, 99}            # Drama, History, Romance, Documentary

    fast_hits = len(genre_ids & fast_genres)
    slow_hits = len(genre_ids & slow_genres)
    total_fs = fast_hits + slow_hits
    if total_fs > 0:
        fs_raw = (fast_hits - slow_hits) / float(total_fs)  # -1..1
    else:
        fs_raw = 0.0

    fs_component = max(-1.0, min(1.0, fs_raw))

    # Runtime component: shorter movies lean fast (-1), very long movies lean slow (+1).
    runtime_component = 0.0
    if runtime is not None:
        runtime_component = _normalize_range(runtime, 80.0, 170.0)  # Map ~80-170 minutes -> -1..1
    # Mixing: genres carry more weight than runtime.
    v[2] = 0.6 * fs_component + 0.4 * runtime_component

    # -------------------------------
    # Axis 3: Plot vs Character
    # -------------------------------
    # Biopics, dramas, romance often more character driven.
    # Mysteries, thrillers, heists more plot-driven.
    plot_keywords = ["twist", "mystery", "investigation", "conspiracy", "heist", "plot"]
    char_keywords = ["character study", "intimate", "coming-of-age", "relationships", "family drama", "portrait"]

    kw_component_pc = _keyword_score(overview, plot_keywords, char_keywords)  # + = more plot, - = more character
    # Note: _keyword_score returns pos-neg, so we invert semantics for axis: -1=plot, +1=character.
    kw_component_pc = -kw_component_pc

    plot_genres = {9648, 53, 80}                 # Mystery, Thriller, Crime
    char_genres = {18, 10749, 36}                # Drama, Romance, History/Biopic-ish

    plot_hits = len(genre_ids & plot_genres)
    char_hits = len(genre_ids & char_genres)
    total_pc = plot_hits + char_hits
    if total_pc > 0:
        pc_raw = (plot_hits - char_hits) / float(total_pc)  # + = more plot, - = more character
    else:
        pc_raw = 0.0

    # Map to axis convention: -1 = plot-driven, +1 = character-driven
    genre_component_pc = -max(-1.0, min(1.0, pc_raw))
    v[3] = 0.5 * kw_component_pc + 0.5 * genre_component_pc

    # -------------------------------
    # Axis 4: Action vs Dialogue
    # -------------------------------
    # Action genres pull negative, talky genres pull positive.
    action_genres = {28, 12, 878, 10752}
    dialogue_genres = {18, 35, 10749}

    action_hits = len(genre_ids & action_genres)
    dialogue_hits = len(genre_ids & dialogue_genres)
    total_ad = action_hits + dialogue_hits
    if total_ad > 0:
        ad_raw = (action_hits - dialogue_hits) / float(total_ad)  # + = more action, - = more dialogue
    else:
        ad_raw = 0.0

    # Axis convention: -1 = action-heavy, +1 = dialogue-heavy
    v[4] = max(-1.0, min(1.0, -ad_raw))

    # -------------------------------
    # Axis 5: Old vs New
    # -------------------------------
    # Map year ~1960..2025 -> -1..1
    if year is not None:
        v[5] = _normalize_range(year, 1960.0, 2025.0)
    else:
        v[5] = 0.0

    # -------------------------------
    # Axis 6: Realistic vs Fantastical
    # -------------------------------
    # Fantasy/Sci-Fi/Animation lean fantastical; Documentary/Drama/History lean realistic.
    fantastical_genres = {14, 878, 16, 12, 10765}  # Fantasy, Sci-Fi, Animation, Adventure, (TV fantasy id)
    realistic_genres = {99, 18, 36, 10752}         # Documentary, Drama, History, War

    fant_hits = len(genre_ids & fantastical_genres)
    real_hits = len(genre_ids & realistic_genres)
    total_rf = fant_hits + real_hits
    if total_rf > 0:
        rf_raw = (fant_hits - real_hits) / float(total_rf)  # + = more fantastical, - = more realistic
    else:
        rf_raw = 0.0

    v[6] = max(-1.0, min(1.0, rf_raw))

    # -------------------------------
    # Axis 7: Optimistic vs Bleak
    # -------------------------------
    # Heavily keyword-driven; optional genre hint for horror/war.
    optimistic_keywords = ["uplifting", "heartwarming", "inspiring", "feel-good", "hope", "triumph", "redemption"]
    bleak_keywords = ["bleak", "nihilistic", "tragic", "tragedy", "apocalyptic", "devastating", "brutal", "grim"]

    kw_component_ob = _keyword_score(overview, optimistic_keywords, bleak_keywords)

    # Horror/war/serious crime lean bleak.
    bleak_genres = {27, 80, 53, 10752}
    opt_genres = {10751, 35, 16, 10402}  # Family, Comedy, Animation, Music

    bleak_hits = len(genre_ids & bleak_genres)
    opt_hits = len(genre_ids & opt_genres)
    total_ob = bleak_hits + opt_hits
    if total_ob > 0:
        ob_raw = (opt_hits - bleak_hits) / float(total_ob)
    else:
        ob_raw = 0.0

    genre_component_ob = max(-1.0, min(1.0, ob_raw))
    v[7] = 0.6 * kw_component_ob + 0.4 * genre_component_ob

    # -------------------------------
    # Axis 8: Short vs Epic
    # -------------------------------
    # Map runtime directly when available.
    if runtime is not None:
        v[8] = _normalize_range(runtime, 80.0, 180.0)
    else:
        v[8] = 0.0

    # -------------------------------
    # Axis 9: Comfort vs Challenging
    # -------------------------------
    # Derive from other axes:
    # - Comfort: mainstream (0-), light (1-), fast(2-), optimistic(7+), short(8-)
    # - Challenging: arthouse (0+), dark (1+), slow (2+), bleak(7-), epic(8+)
    # We'll blend a few of these.
    comfort_components = [
        -v[0],  # mainstream
        -v[1],  # light/fun
        -v[2],  # fast
        v[7],   # optimistic
        -v[8],  # short
    ]
    # Average then clip.
    if comfort_components:
        raw_c = sum(comfort_components) / float(len(comfort_components))
    else:
        raw_c = 0.0

    v[9] = max(-1.0, min(1.0, raw_c))

    # Final safety clip
    v = [max(-1.0, min(1.0, val)) for val in v]
    return v

# --- TMDB search + upsert helpers for on-demand ingestion ---


def tmdb_search_movies(query: str, page: int = 1, include_adult: bool = False) -> list[dict]:
    """
    Call TMDB's /search/movie endpoint and return the list of results.

    This is used for on-demand ingestion when a user searches for a movie
    that we might not yet have in our local database.
    """
    query = (query or "").strip()
    if not query:
        return []

    data = tmdb_get(
        "/search/movie",
        params={
            "query": query,
            "page": page,
            "include_adult": include_adult,
            "language": "en-US",
        },
    )
    return data.get("results") or []


def upsert_movie_and_vibe_from_tmdb(movie: dict) -> None:
    """
    Given a TMDB movie payload, upsert a row into public.movies and public.movie_vibes.

    Assumes:
    - The Supabase public.movies table uses the TMDB movie id as its primary key (id).
    - The public.movie_vibes table uses movie_id as FK to movies.id.
    """
    mid = movie.get("id")
    if mid is None:
        return

    genre_ids = extract_genre_ids(movie)

    movie_row = {
        "id": mid,
        "title": movie.get("title") or movie.get("name"),
        "original_title": movie.get("original_title"),
        "overview": movie.get("overview"),
        "release_date": movie.get("release_date"),
        "runtime_minutes": None,  # can be filled by a detail fetch later
        "poster_path": movie.get("poster_path"),
        "popularity": movie.get("popularity"),
        "vote_average": movie.get("vote_average"),
        "vote_count": movie.get("vote_count"),
        "original_language": movie.get("original_language"),
        "genres": genre_ids,
        "is_adult": movie.get("adult", False),
    }

    # Upsert movie metadata
    supabase.table("movies").upsert(movie_row, on_conflict="id").execute()

    # Compute and upsert vibe vector
    vibe_vector = compute_movie_vibe(movie)
    vibe_row = {
        "movie_id": mid,
        "vibe_vector": vibe_vector,
    }
    supabase.table("movie_vibes").upsert(vibe_row, on_conflict="movie_id").execute()

# --- User/movie similarity helpers ---

def cosine_similarity(u_vec: list[float], m_vec: list[float]) -> float:
    """
    Compute cosine similarity between two equal-length vectors.
    Returns a value in [-1, 1]. If either vector has zero norm, returns 0.
    """
    if not u_vec or not m_vec or len(u_vec) != len(m_vec):
        return 0.0
    dot = 0.0
    norm_u = 0.0
    norm_m = 0.0
    for u, m in zip(u_vec, m_vec):
        dot += u * m
        norm_u += u * u
        norm_m += m * m
    if norm_u <= 0.0 or norm_m <= 0.0:
        return 0.0
    return dot / (math.sqrt(norm_u) * math.sqrt(norm_m))


def attach_similarity_to_movies(movies: list[dict], user_id: Optional[str]) -> list[dict]:
    """
    Given a list of movie rows and an optional user_id, attach a 'similarity'
    field based on the user's preference_vector and each movie's vibe_vector.

    If user_id is None or no preference_vector exists, similarity is left as 0.0.
    """
    if not movies or not user_id:
      # No user context; just return movies with similarity 0.0
      return [{**m, "similarity": 0.0} for m in movies]

    # Load user preference vector
    prefs_res = (
        supabase.table("user_preferences")
        .select("preference_vector")
        .eq("user_id", user_id)
        .execute()
    )
    if not prefs_res.data:
        return [{**m, "similarity": 0.0} for m in movies]

    pref_vec = prefs_res.data[0].get("preference_vector") or []
    if not pref_vec or len(pref_vec) != 10:
        return [{**m, "similarity": 0.0} for m in movies]

    # Load vibe vectors for all movies in a single query
    movie_ids = [m.get("id") for m in movies if m.get("id") is not None]
    if not movie_ids:
        return [{**m, "similarity": 0.0} for m in movies]

    mv_res = (
        supabase.table("movie_vibes")
        .select("movie_id, vibe_vector")
        .in_("movie_id", movie_ids)
        .execute()
    )
    vibe_map = {}
    for row in mv_res.data or []:
        vid = row.get("movie_id")
        vvec = row.get("vibe_vector") or []
        if vid is not None and vvec and len(vvec) == len(pref_vec):
            vibe_map[vid] = vvec

    enriched: list[dict] = []
    for m in movies:
        mid = m.get("id")
        vvec = vibe_map.get(mid)
        sim = cosine_similarity(pref_vec, vvec) if vvec else 0.0
        enriched.append({**m, "similarity": sim})

    return enriched

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

@app.post("/v1/preferences/quiz")
def save_user_preferences(payload: PreferencesPayload):
    """
    Save or update a user's movie preferences derived from the vibe quiz.

    Body:
    - user_id: UUID of the user (string form)
    - quizVersion: version of the quiz used (e.g., "v1")
    - answers: list of { questionId, choice } pairs
    - preferenceVector: list of floats (e.g., 10-dim vector in [-1, 1])

    Behavior:
    - Upserts into user_preferences keyed by user_id so a user can retake
      the quiz and overwrite their previous preferences.
    """
    try:
        # Basic validation of vector length (optional but helpful)
        if not payload.preferenceVector:
            raise HTTPException(status_code=400, detail="preferenceVector must not be empty")

        # Prepare row for Supabase
        row = {
            "user_id": payload.user_id,
            "quiz_version": payload.quizVersion,
            "raw_answers": {
                "quizVersion": payload.quizVersion,
                "answers": [answer.model_dump() for answer in payload.answers],
            },
            "preference_vector": payload.preferenceVector,
        }

        # Upsert so that re-taking the quiz overwrites the previous row
        result = (
            supabase.table("user_preferences")
            .upsert(row, on_conflict="user_id")
            .execute()
        )

        if not result.data:
            raise HTTPException(status_code=500, detail="Failed to save user preferences")

        return {
            "status": "ok",
            "user_id": payload.user_id,
            "quiz_version": payload.quizVersion,
            "preference_vector": payload.preferenceVector,
        }
    except HTTPException:
        # Re-raise any explicit HTTPException
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class BlendRecommendationsPayload(BaseModel):
    preference_vectors: dict  # { user_id: [float, float, ...] }
    max_movies: int = 600  # max movies to compute blend scores for


@app.post("/v1/blend/recommendations")
def get_blend_recommendations(payload: BlendRecommendationsPayload):
    """
    Get categorized movie recommendations for a blend of users.

    Body:
    - preference_vectors: dict mapping user_id to preference vector
    - max_movies: max movies to evaluate (default 600)

    Returns:
    - top_picks: list of top 10 blend-scored movies
    - categories: dict { category_name: [ { movie }, { movie }, ... ] }
      where each category has ~20 movies sorted by blend score
    """
    # TMDB genre ID to name mapping
    GENRE_NAMES = {
        12: "Adventure",
        14: "Fantasy",
        16: "Animation",
        18: "Drama",
        27: "Horror",
        28: "Action",
        35: "Comedy",
        36: "History",
        37: "Western",
        53: "Thriller",
        80: "Crime",
        99: "Documentary",
        878: "Science Fiction",
        9648: "Mystery",
        10402: "Music",
        10749: "Romance",
        10751: "Family",
        10752: "War",
        10770: "TV Movie",
    }
    
    try:
        if not payload.preference_vectors:
            return {"top_picks": [], "categories": {}}

        # Fetch movie vibes + movies
        mvs_res = (
            supabase.table("movie_vibes")
            .select("movie_id, vibe_vector, movie:movies(*)")
            .limit(payload.max_movies)
            .execute()
        )

        movies_with_vibes = mvs_res.data or []

        # Compute blend scores for each movie
        scored_movies = []
        for mv in movies_with_vibes:
            movie = mv.get("movie") or {}
            vibe = mv.get("vibe_vector") or []

            if not vibe:
                continue

            # Compute avg cosine similarity across all preference vectors
            similarities = []
            for pref_vec in payload.preference_vectors.values():
                if pref_vec and len(pref_vec) == len(vibe):
                    dot = sum(p * v for p, v in zip(pref_vec, vibe))
                    mag_p = math.sqrt(sum(p * p for p in pref_vec))
                    mag_v = math.sqrt(sum(v * v for v in vibe))
                    if mag_p > 0 and mag_v > 0:
                        cos = dot / (mag_p * mag_v)
                        similarities.append(cos)

            blend_score = sum(similarities) / len(similarities) if similarities else 0
            movie["blend_score"] = blend_score
            scored_movies.append(movie)

        # Sort by blend score
        scored_movies.sort(key=lambda m: m.get("blend_score", 0), reverse=True)

        # Top 10
        top_picks = scored_movies[:10]

        # Group by genre and return top 20 per category
        categories = {}
        genre_map = {}

        logging.info(f"Starting genre mapping with {len(scored_movies)} movies")
        for movie in scored_movies:
            genres = movie.get("genres") or []
            logging.debug(f"Movie {movie.get('title', 'unknown')} genres raw: {genres}, type: {type(genres)}")
            # genres might be a list of IDs (ints) or a comma-separated string
            if isinstance(genres, str):
                genres = [int(g.strip()) for g in genres.split(",") if g.strip().isdigit()]
            elif not isinstance(genres, list):
                continue
            
            for genre_id in genres:
                logging.debug(f"Processing genre_id: {genre_id}, type: {type(genre_id)}")
                # Ensure genre_id is an int
                if isinstance(genre_id, str):
                    try:
                        genre_id = int(genre_id)
                    except ValueError:
                        continue
                elif not isinstance(genre_id, int):
                    continue
                
                # Map ID to readable name
                genre_name = GENRE_NAMES.get(genre_id, f"Genre {genre_id}")
                logging.debug(f"Mapped genre_id {genre_id} to genre_name '{genre_name}'")
                
                if genre_name not in genre_map:
                    genre_map[genre_name] = []
                if len(genre_map[genre_name]) < 20:
                    genre_map[genre_name].append(movie)

        # Convert to response format
        for genre, movies in genre_map.items():
            categories[genre] = movies

        # Debug output
        logging.info(f"genre_map keys: {list(genre_map.keys())}")
        logging.info(f"categories keys: {list(categories.keys())}")
        logging.info(f"categories type: {type(categories)}")

        return {
            "top_picks": top_picks,
            "categories": categories,
        }

    except Exception as e:
        print(f"Error computing blend recommendations: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/v1/preferences/batch")
def get_user_preferences_batch(payload: PreferencesBatchPayload):
    """
    Return preference vectors for a list of user_ids.

    Body:
    - user_ids: list of UUID strings
    """
    if not payload.user_ids:
        return {"preferences": []}

    try:
        res = (
            supabase.table("user_preferences")
            .select("user_id, preference_vector")
            .in_("user_id", payload.user_ids)
            .execute()
        )
        return {"preferences": res.data or []}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- Ingestion endpoint for TMDB trending/popular ---

@app.post("/v1/admin/ingest/trending")
def ingest_trending_and_popular(x_ingestion_secret: Optional[str] = Header(None)):
    """
    Ingest trending and popular movies from TMDB into the local movies + movie_vibes tables.

    This is intended to be called from a scheduled job (e.g., Supabase cron) using
    a shared secret provided via the X-Ingestion-Secret header.

    Behavior:
    - Fetch several pages of TMDB trending (week) and popular movies.
    - Upsert basic metadata into public.movies.
    - Compute a 10D vibe_vector for each movie and upsert into public.movie_vibes.
    """
    # Optional protection via shared secret
    if INGESTION_SECRET:
        if not x_ingestion_secret or x_ingestion_secret != INGESTION_SECRET:
            raise HTTPException(status_code=403, detail="Forbidden")

    try:
        aggregated: dict[int, dict] = {}

        # -----------------------------------------
        # Fetch multiple pages of core catalog slices
        # -----------------------------------------

        # 1) Trending (week), Popular, Top Rated
        for page in range(1, 6):
            trending = tmdb_get("/trending/movie/week", params={"page": page})
            for m in trending.get("results", []):
                mid = m.get("id")
                if mid is not None:
                    aggregated[mid] = m

            popular = tmdb_get("/movie/popular", params={"page": page})
            for m in popular.get("results", []):
                mid = m.get("id")
                if mid is not None:
                    aggregated[mid] = m

            top_rated = tmdb_get("/movie/top_rated", params={"page": page})
            for m in top_rated.get("results", []):
                mid = m.get("id")
                if mid is not None:
                    aggregated[mid] = m

        # 2) Now Playing + Upcoming (smaller page range)
        for page in range(1, 3):
            now_playing = tmdb_get("/movie/now_playing", params={"page": page})
            for m in now_playing.get("results", []):
                mid = m.get("id")
                if mid is not None:
                    aggregated[mid] = m

        # 3) A few genre-focused discover slices to diversify catalog
        #    (Horror, Comedy, Drama, Sci-Fi), only first page each to limit calls.
        genre_slices = [27, 35, 18, 878]  # Horror, Comedy, Drama, Sci-Fi
        for gid in genre_slices:
            discover = tmdb_get(
                "/discover/movie",
                params={
                    "with_genres": gid,
                    "sort_by": "popularity.desc",
                    "page": 1,
                },
            )
            for m in discover.get("results", []):
                mid = m.get("id")
                if mid is not None:
                    aggregated[mid] = m

        if not aggregated:
            return {"status": "ok", "ingested": 0, "message": "No movies returned from TMDB."}

        movie_rows = []
        vibe_rows = []

        for mid, m in aggregated.items():
            genre_ids = extract_genre_ids(m)

            movie_rows.append({
                "id": mid,
                "title": m.get("title") or m.get("name"),
                "original_title": m.get("original_title"),
                "overview": m.get("overview"),
                "release_date": m.get("release_date"),
                "runtime_minutes": None,  # can be filled by a detail fetch later
                "poster_path": m.get("poster_path"),
                "popularity": m.get("popularity"),
                "vote_average": m.get("vote_average"),
                "vote_count": m.get("vote_count"),
                "original_language": m.get("original_language"),
                "genres": genre_ids,
                "is_adult": m.get("adult", False),
            })

            vibe_vector = compute_movie_vibe(m)
            vibe_rows.append({
                "movie_id": mid,
                "vibe_vector": vibe_vector,
            })

        # Upsert into movies
        if movie_rows:
            supabase.table("movies").upsert(movie_rows, on_conflict="id").execute()

        # Upsert into movie_vibes
        if vibe_rows:
            supabase.table("movie_vibes").upsert(vibe_rows, on_conflict="movie_id").execute()

        return {
            "status": "ok",
            "ingested": len(movie_rows),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- Debug endpoint: inspect movie vibe vector ---

@app.get("/v1/debug/vector/{movie_id}")
def debug_movie_vector(movie_id: int):
    """
    Debug helper to inspect a movie's stored vibe vector and basic metadata.

    Returns:
    - movie: row from public.movies
    - vibe_vector: 10D vector from public.movie_vibes (if present)
    """
    try:
        mv = (
            supabase.table("movie_vibes")
            .select("movie_id, vibe_vector")
            .eq("movie_id", movie_id)
            .execute()
        )
        if not mv.data:
            raise HTTPException(status_code=404, detail="No vibe vector found for this movie_id")

        movie_res = (
            supabase.table("movies")
            .select("*")
            .eq("id", movie_id)
            .execute()
        )
        movie_row = movie_res.data[0] if movie_res.data else None

        return {
            "movie_id": movie_id,
            "movie": movie_row,
            "vibe_vector": mv.data[0]["vibe_vector"],
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- Home feed endpoint: personalized sections based on user preference vector ---

@app.get("/v1/home")
def get_home_feed(user_id: str, max_candidates: int = 500):
    """
    Build a simple personalized home feed for the given user_id.

    Query params:
    - user_id: UUID string (must exist in user_preferences)
    - max_candidates: max number of candidate movies to consider (default 500)

    Behavior:
    - Fetch the user's preference_vector from user_preferences.
    - Fetch up to max_candidates movies joined with movie_vibes, biased toward popularity.
    - Compute cosine similarity between user vector and each movie's vibe_vector.
    - Return a small set of sections with ranked movies.
    """
    try:
        # 1) Load user preference vector
        prefs_res = (
            supabase.table("user_preferences")
            .select("preference_vector")
            .eq("user_id", user_id)
            .execute()
        )
        if not prefs_res.data:
            raise HTTPException(status_code=404, detail="No preferences found for this user_id")

        pref_vec = prefs_res.data[0].get("preference_vector") or []
        if not pref_vec or len(pref_vec) != 10:
            raise HTTPException(status_code=400, detail="Invalid or missing preference_vector for user")

        # 2) Fetch candidate movies + their vibe vectors
        # We select from movie_vibes with an embedded movies(*) relation (via FK),
        # limited and roughly sorted by popularity desc.
        mv_res = (
            supabase.table("movie_vibes")
            .select("movie_id, vibe_vector, movies(*)")
            .limit(max_candidates)
            .execute()
        )

        candidates = []
        for row in mv_res.data or []:
            movie = row.get("movies")
            if not movie:
                continue
            vibe_vec = row.get("vibe_vector") or []
            if not vibe_vec or len(vibe_vec) != len(pref_vec):
                continue
            sim = cosine_similarity(pref_vec, vibe_vec)
            popularity = movie.get("popularity") or 0.0
            candidates.append(
                {
                    "movie": movie,
                    "similarity": sim,
                    "popularity": float(popularity),
                    "vibe_vector": vibe_vec,
                }
            )

        if not candidates:
            return {
                "user_id": user_id,
                "sections": [],
                "message": "No candidate movies available. Run ingestion first.",
            }

        # Helper to sort with a secondary key for stability
        def sort_by(key_fn, reverse=True):
            return sorted(candidates, key=key_fn, reverse=reverse)

        current_year = datetime.utcnow().year

        def get_year(m: dict) -> Optional[int]:
            rd = m.get("release_date")
            if not rd:
                return None
            try:
                return int(rd.split("-")[0])
            except Exception:
                return None

        # Section 1: Tonight's picks (pure similarity)
        tonights_picks = sort_by(lambda c: c["similarity"])[:20]

        # Section 2: Trending for you (mix similarity and popularity)
        def trend_score(c):
            pop_norm = _normalize_range(c["popularity"], 0.0, 150.0)
            return 0.7 * c["similarity"] + 0.3 * pop_norm

        trending_for_you = sorted(candidates, key=trend_score, reverse=True)[:20]

        # Section 3: New & buzzy (recent releases, tuned to you)
        new_candidates = []
        for c in candidates:
            year = get_year(c["movie"])
            if year is not None and year >= current_year - 2:
                new_candidates.append(c)
        if not new_candidates:
            new_candidates = candidates
        new_for_you = sorted(new_candidates, key=trend_score, reverse=True)[:20]

        # Section 4: Modern classics (90s–5 years ago, high vote_count, tuned to you)
        modern_candidates = []
        for c in candidates:
            m = c["movie"]
            year = get_year(m)
            vote_count = m.get("vote_count") or 0
            if year is not None and 1990 <= year <= current_year - 5 and vote_count >= 500:
                modern_candidates.append(c)
        if not modern_candidates:
            modern_candidates = candidates
        modern_classics = sort_by(lambda c: c["similarity"])[:20] if not modern_candidates else sort_by(lambda c: c["similarity"], reverse=True)[:20]

        # Section 5: Comfort zone (high comfort dimension in vibe vector)
        comfort_candidates = []
        for c in candidates:
            vvec = c.get("vibe_vector") or []
            comfort = vvec[9] if len(vvec) > 9 else 0.0
            c_score = 0.6 * comfort + 0.4 * c["similarity"]
            comfort_candidates.append((c, c_score))
        comfort_sorted = sorted(comfort_candidates, key=lambda x: x[1], reverse=True)
        comfort_zone = [cs[0] for cs in comfort_sorted[:20]]

        # Section 6: Dark & moody (darker, bleaker vibe)
        dark_candidates = []
        for c in candidates:
            vvec = c.get("vibe_vector") or []
            if len(vvec) < 8:
                continue
            light_dark = vvec[1]    # +1 = dark
            optimistic = vvec[7]    # -1 = bleak
            dark_score = 0.6 * light_dark - 0.4 * optimistic
            dark_candidates.append((c, dark_score))
        dark_sorted = sorted(dark_candidates, key=lambda x: x[1], reverse=True)
        dark_and_moody = [ds[0] for ds in dark_sorted[:20]] or tonights_picks

        # Format movies for response (add similarity but hide internal internals)
        def format_movies(items):
            out = []
            for item in items:
                m = item["movie"]
                out.append(
                    {
                        **m,
                        "similarity": item["similarity"],
                    }
                )
            return out

        sections = [
            {
                "id": "tonights_picks",
                "title": "Tonight’s picks for you",
                "style": "rail",
                "movies": format_movies(tonights_picks),
            },
            {
                "id": "trending_for_you",
                "title": "Trending, tuned to your vibe",
                "style": "rail",
                "movies": format_movies(trending_for_you),
            },
            {
                "id": "new_for_you",
                "title": "New & buzzy for you",
                "style": "rail",
                "movies": format_movies(new_for_you),
            },
            {
                "id": "modern_classics",
                "title": "Modern classics you might love",
                "style": "rail",
                "movies": format_movies(modern_classics),
            },
            {
                "id": "comfort_zone",
                "title": "Comfort rewatches & cozy picks",
                "style": "rail",
                "movies": format_movies(comfort_zone),
            },
            {
                "id": "dark_and_moody",
                "title": "Dark & moody picks",
                "style": "rail",
                "movies": format_movies(dark_and_moody),
            },
        ]

        return {
            "user_id": user_id,
            "sections": sections,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- Search endpoint: on-demand TMDB ingestion + local search ---


@app.get("/v1/search/movies")
def search_movies(
    q: str,
    user_id: Optional[str] = None,
    limit: int = 20,
    include_adult: bool = False,
):
    """
    Search for movies by title.

    Behavior:
    - First search the local movies table with a case-insensitive ILIKE on title.
    - If we find fewer than a threshold of local results, call TMDB's /search/movie
      to fetch additional matches, upsert them (and their vibe vectors) into
      movies + movie_vibes, then re-query locally.
    - Optionally attach a 'similarity' score for each movie if user_id is provided.

    Query params:
    - q: search query string (required)
    - user_id: optional user id to compute similarity against preference_vector
    - limit: max number of results to return
    - include_adult: whether to include adult titles in TMDB search (default False)
    """
    query = (q or "").strip()
    if not query:
        raise HTTPException(status_code=400, detail="Query parameter 'q' must not be empty.")

    if limit <= 0 or limit > 50:
        raise HTTPException(status_code=400, detail="limit must be between 1 and 50")

    try:
        # 1) Local search
        local_res = (
            supabase.table("movies")
            .select("*")
            .ilike("title", f"%{query}%")
            .order("popularity", desc=True)
            .limit(limit)
            .execute()
        )
        local_movies = local_res.data or []

        MIN_LOCAL = 8

        # 2) If we don't have enough local matches, call TMDB and ingest
        if len(local_movies) < MIN_LOCAL:
            tmdb_results = tmdb_search_movies(query, page=1, include_adult=include_adult)

            for m in tmdb_results:
                try:
                    upsert_movie_and_vibe_from_tmdb(m)
                except Exception as e:
                    # Log but don't fail the entire search because of one movie
                    print(f"Error upserting TMDB movie {m.get('id')}: {e}")

            # Re-query local after ingestion
            local_res = (
                supabase.table("movies")
                .select("*")
                .ilike("title", f"%{query}%")
                .order("popularity", desc=True)
                .limit(limit)
                .execute()
            )
            local_movies = local_res.data or []

        # 3) Attach similarity if we have a user context
        enriched_movies = attach_similarity_to_movies(local_movies, user_id)

        return {
            "query": query,
            "count": len(enriched_movies),
            "results": enriched_movies,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



# --- Social graph endpoints: user relationships (followers / following) ---

@app.get("/v1/relationships")
def list_relationships(user_id: str):
    """
    List relationships for a given user_id plus follower/following counts.

    Semantics:
    - user_relationships.user_id = follower (the one who initiated / follows)
    - user_relationships.target_user_id = followed user

    Returns:
    - counts: followers / following
    - relationships: list of other users with basic profile info and direction
    """
    try:
        # 1) Basic counts for followers / following
        following_res = (
            supabase.table("user_relationships")
            .select("id", count="exact")
            .eq("user_id", user_id)
            .eq("status", "accepted")
            .execute()
        )
        followers_res = (
            supabase.table("user_relationships")
            .select("id", count="exact")
            .eq("target_user_id", user_id)
            .eq("status", "accepted")
            .execute()
        )

        following_count = following_res.count or 0
        followers_count = followers_res.count or 0

        # 2) Fetch all relationships involving this user (any status)
        rel_res = (
            supabase.table("user_relationships")
            .select("id, user_id, target_user_id, status, created_at, updated_at")
            .or_(f"user_id.eq.{user_id},target_user_id.eq.{user_id}")
            .execute()
        )

        relationships = rel_res.data or []

        # Collect the "other" user IDs to hydrate from profiles
        other_ids: set[str] = set()
        for rel in relationships:
            uid = rel.get("user_id")
            tid = rel.get("target_user_id")
            if uid == user_id and tid:
                other_ids.add(tid)
            elif tid == user_id and uid:
                other_ids.add(uid)

        profiles_map: dict[str, dict] = {}
        if other_ids:
            prof_res = (
                supabase.table("profiles")
                .select("id, display_name, avatar_url")
                .in_("id", list(other_ids))
                .execute()
            )
            for row in prof_res.data or []:
                pid = row.get("id")
                if pid:
                    profiles_map[pid] = row

        # 3) Build a clean, frontend-friendly payload
        formatted = []
        for rel in relationships:
            rid = rel.get("id")
            uid = rel.get("user_id")
            tid = rel.get("target_user_id")
            status = rel.get("status")

            if not rid or (uid != user_id and tid != user_id):
                continue

            if uid == user_id:
                direction = "following"
                other_id = tid
            else:
                direction = "follower"
                other_id = uid

            if not other_id:
                continue

            prof = profiles_map.get(other_id, {})
            formatted.append(
                {
                    "relationship_id": rid,
                    "other_user_id": other_id,
                    "direction": direction,
                    "status": status,
                    "display_name": prof.get("display_name"),
                    "avatar_url": prof.get("avatar_url"),
                    "created_at": rel.get("created_at"),
                    "updated_at": rel.get("updated_at"),
                }
            )

        return {
            "user_id": user_id,
            "counts": {
                "followers": followers_count,
                "following": following_count,
            },
            "relationships": formatted,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/v1/relationships/request")
def request_relationship(payload: RelationshipRequestPayload):
    """
    Initiate a relationship from user_id -> target_user_id.

    This behaves like a "follow" or "friend request", stored as:
    - user_id: follower / initiator
    - target_user_id: followed user
    - status: 'pending' (until accepted)
    """
    if payload.user_id == payload.target_user_id:
        raise HTTPException(status_code=400, detail="Cannot follow yourself.")

    try:
        # Check if this specific directional relationship already exists (user_id -> target_user_id)
        rel_res = (
            supabase.table("user_relationships")
            .select("id, status")
            .eq("user_id", payload.user_id)
            .eq("target_user_id", payload.target_user_id)
            .execute()
        )

        if rel_res.data:
            existing = rel_res.data[0]
            status = existing.get("status")
            if status == "accepted":
                raise HTTPException(status_code=400, detail="You are already following this user.")
            elif status == "pending":
                raise HTTPException(status_code=400, detail="Follow request already pending.")
            else:
                raise HTTPException(status_code=400, detail="Relationship already exists.")

        # Insert new pending relationship
        insert_data = {
            "user_id": payload.user_id,
            "target_user_id": payload.target_user_id,
            "status": "pending",
        }
        ins = supabase.table("user_relationships").insert(insert_data).execute()
        if not ins.data:
            raise HTTPException(status_code=500, detail="Failed to create relationship request.")

        row = ins.data[0]
        return {
            "status": "ok",
            "relationship_id": row.get("id"),
            "user_id": payload.user_id,
            "target_user_id": payload.target_user_id,
            "relationship_status": row.get("status"),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/v1/relationships/respond")
def respond_relationship(payload: RelationshipRespondPayload):
    """
    Respond to an existing relationship request.

    Only the target_user_id of a pending relationship may accept or reject it.

    - action = "accept" -> status set to 'accepted'
    - action = "reject" -> relationship row is deleted
    """
    try:
        rel_res = (
            supabase.table("user_relationships")
            .select("id, user_id, target_user_id, status")
            .eq("id", payload.relationship_id)
            .execute()
        )

        if not rel_res.data:
            raise HTTPException(status_code=404, detail="Relationship not found.")

        rel = rel_res.data[0]
        target_id = rel.get("target_user_id")
        status = rel.get("status")

        if target_id != payload.user_id:
            raise HTTPException(
                status_code=403,
                detail="Only the target user may respond to this relationship."
            )

        if status != "pending":
            raise HTTPException(
                status_code=400,
                detail=f"Cannot respond to relationship with status '{status}'."
            )

        if payload.action == "accept":
            upd = (
                supabase.table("user_relationships")
                .update({"status": "accepted"})
                .eq("id", payload.relationship_id)
                .execute()
            )
            if not upd.data:
                raise HTTPException(status_code=500, detail="Failed to update relationship.")
            new_status = upd.data[0].get("status")
            return {"status": "ok", "relationship_id": payload.relationship_id, "new_status": new_status}

        elif payload.action == "reject":
            _ = (
                supabase.table("user_relationships")
                .delete()
                .eq("id", payload.relationship_id)
                .execute()
            )
            return {"status": "ok", "relationship_id": payload.relationship_id, "new_status": "rejected"}

        else:
            raise HTTPException(status_code=400, detail="Invalid action. Use 'accept' or 'reject'.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- Watch and React endpoint ---
@app.post("/v1/movies/{movie_id}/watch-and-react")
def watch_and_react(movie_id: int, payload: WatchAndReactPayload):
    """Record that a user just watched a movie, capture their rating/reaction,
    append to watch_history, and update their preference_vector.

    Body:
    - user_id: UUID string
    - rating: int (1-5)
    - reaction: "like" | "meh" | "dislike"
    - review: optional free text
    - watched_at: optional ISO timestamp; defaults to now.
    """
    # 1) Validate rating range
    if payload.rating < 1 or payload.rating > 5:
        raise HTTPException(status_code=400, detail="rating must be between 1 and 5")

    try:
        # 2) Load movie vibe vector
        mv_res = (
            supabase.table("movie_vibes")
            .select("vibe_vector")
            .eq("movie_id", movie_id)
            .execute()
        )
        if not mv_res.data:
            raise HTTPException(status_code=404, detail="No vibe vector found for this movie_id")

        movie_vibe = mv_res.data[0].get("vibe_vector") or []
        if not movie_vibe:
            raise HTTPException(status_code=500, detail="Movie vibe vector is empty or invalid")

        dim = len(movie_vibe)

        # 3) Load existing user preference_vector (if any)
        prefs_res = (
            supabase.table("user_preferences")
            .select("preference_vector, quiz_version, raw_answers")
            .eq("user_id", payload.user_id)
            .execute()
        )

        base_vec: list[float]
        quiz_version = None
        raw_answers = None

        if prefs_res.data:
            row = prefs_res.data[0]
            existing_vec = row.get("preference_vector") or []
            quiz_version = row.get("quiz_version")
            raw_answers = row.get("raw_answers")
            if not existing_vec or len(existing_vec) != dim:
                base_vec = [0.0] * dim
            else:
                base_vec = list(existing_vec)
        else:
            # No preferences yet: start from zero vector
            base_vec = [0.0] * dim

        # 4) Compute signal from rating + reaction
        rating_score = (payload.rating - 3) / 2.0  # 1->-1, 3->0, 5->+1
        if payload.reaction == "like":
            reaction_factor = 1.0
        elif payload.reaction == "meh":
            reaction_factor = 0.3
        else:  # "dislike"
            reaction_factor = -1.0

        signal = rating_score * reaction_factor

        # If signal is near zero, do a very small update
        alpha_base = 0.15
        alpha = alpha_base * abs(signal)
        if alpha == 0:
            alpha = 0.05

        direction = 1.0 if signal >= 0 else -1.0

        new_vec: list[float] = []
        for ui, mi in zip(base_vec, movie_vibe):
            target = direction * mi
            updated = (1 - alpha) * ui + alpha * target
            # Clip to [-1, 1]
            if updated > 1.0:
                updated = 1.0
            elif updated < -1.0:
                updated = -1.0
            new_vec.append(updated)

        # 5) Upsert/update user_preferences with new vector
        if prefs_res.data:
            # Update only the preference_vector
            upd_res = (
                supabase.table("user_preferences")
                .update({"preference_vector": new_vec})
                .eq("user_id", payload.user_id)
                .execute()
            )
        else:
            # Bootstrap a new row, mark quiz_version as implicit
            row = {
                "user_id": payload.user_id,
                "quiz_version": "implicit_v1",
                "raw_answers": raw_answers or {},
                "preference_vector": new_vec,
            }
            upd_res = (
                supabase.table("user_preferences")
                .upsert(row, on_conflict="user_id")
                .execute()
            )


        # 6) Upsert into user_movie_reactions
        umr_res = (
            supabase.table("user_movie_reactions")
            .select("reaction_id")
            .eq("user_id", payload.user_id)
            .eq("movie_id", movie_id)
            .execute()
        )

        now_iso = datetime.utcnow().isoformat() + "Z"

        if umr_res.data:
            reaction_id = umr_res.data[0].get("reaction_id")
            if not reaction_id:
                reaction_id = str(uuid.uuid4())

            update_data = {
                "rating": payload.rating,
                "reaction": payload.reaction,
                "review": payload.review,
                "updated_at": now_iso,
            }

            r_upd = (
                supabase.table("user_movie_reactions")
                .update(update_data)
                .eq("user_id", payload.user_id)
                .eq("movie_id", movie_id)
                .execute()
            )

        else:
            reaction_id = str(uuid.uuid4())
            insert_data = {
                "reaction_id": reaction_id,
                "user_id": payload.user_id,
                "movie_id": movie_id,
                "rating": payload.rating,
                "reaction": payload.reaction,
                "review": payload.review,
                "created_at": now_iso,
                "updated_at": now_iso,
            }

            r_ins = supabase.table("user_movie_reactions").insert(insert_data).execute()

        # 7) Insert into watch_history (always allow rewatches)
        watched_at = payload.watched_at.isoformat() if payload.watched_at else now_iso
        wh_insert = {
            "id": str(uuid.uuid4()),
            "user_id": payload.user_id,
            "movie_id": movie_id,
            "reaction_id": reaction_id,
            "watched_at": watched_at,
        }

        wh_res = supabase.table("watch_history").insert(wh_insert).execute()

        return {
            "status": "ok",
            "user_id": payload.user_id,
            "movie_id": movie_id,
            "reaction_id": reaction_id,
            "preference_vector": new_vec,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
if __name__ == "__main__":
    import uvicorn
    import os

    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("cine_api:app", host="0.0.0.0", port=port, reload=False)