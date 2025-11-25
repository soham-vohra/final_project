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

load_dotenv()

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