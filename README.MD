# Movie Database Schema

## Overview

This is a comprehensive movie rating and tracking database built for Supabase. It aggregates ratings from multiple sources (IMDb, Rotten Tomatoes, etc.), allows users to rate movies, track watch history, and create custom lists.

## Entity Relationship Diagram

![ERD Photo](/assets/PNG%20image.png)

## Database Schema

### Tables

#### 1. **movies**
Stores core movie metadata and information.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `title` | TEXT | Movie title (required) |
| `release_year` | INT2 | Year released (1800-2100) |
| `runtime_minutes` | INT2 | Duration in minutes |
| `content_rating` | TEXT | Rating (G, PG, PG-13, R, etc.) |
| `poster_url` | TEXT | URL to movie poster image |
| `synopsis` | TEXT | Movie description/plot summary |
| `external_ids` | JSONB | External IDs (IMDb, TMDB, etc.) |
| `created_at` | TIMESTAMPTZ | Record creation timestamp |
| `updated_at` | TIMESTAMPTZ | Last update timestamp (auto-updated) |

**RLS Policy:** Read access enabled for all users

---

#### 2. **sources**
Rating sources like IMDb, Rotten Tomatoes, Metacritic, etc.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `name` | TEXT | Source name (unique) |
| `scale` | TEXT | Rating scale (e.g., "10", "100") |
| `base_url` | TEXT | Source website URL |

**RLS Policy:** Read access enabled for all users

---

#### 3. **source_ratings**
Ratings from external sources for each movie.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `movie_id` | UUID | Foreign key → movies.id (ON DELETE CASCADE) |
| `source_id` | UUID | Foreign key → sources.id (ON DELETE RESTRICT) |
| `rating` | NUMERIC | Rating value |
| `votes` | INT4 | Number of votes/reviews |
| `last_seen_at` | TIMESTAMPTZ | Last time rating was scraped |
| `raw` | JSONB | Raw data from source API |

**Constraints:**
- Unique combination of `movie_id` and `source_id`
- Rating must be positive

**RLS Policy:** Read access enabled for all users

---

#### 4. **blend_scores**
Aggregated/blended scores calculated from multiple sources.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `movie_id` | UUID | Foreign key → movies.id (ON DELETE CASCADE) |
| `algorithm_version` | TEXT | Version of scoring algorithm used |
| `region` | TEXT | Geographic region (e.g., "US", "UK") |
| `window` | TEXT | Time window for calculation (e.g., "30d") |
| `score` | NUMERIC | Final blended score |
| `score_variance` | NUMERIC | Statistical variance of the score |
| `ci_low` | NUMERIC | Lower confidence interval |
| `ci_high` | NUMERIC | Upper confidence interval |
| `votes_weighted` | INT4 | Weighted vote count |
| `source_count` | INT2 | Number of sources used |
| `inputs_snapshot` | JSONB | Snapshot of input data used |
| `computed_at` | TIMESTAMPTZ | When score was calculated |
| `expires_at` | TIMESTAMPTZ | When score should be recalculated |
| `notes` | TEXT | Additional notes |

**RLS Policy:** Read access enabled for all users

---

#### 5. **profiles**
User profile information linked to Supabase Auth.

| Column | Type | Description |
|--------|------|-------------|
| `user_id` | UUID | Primary key, foreign key → auth.users.id (ON DELETE CASCADE) |
| `display_name` | TEXT | User's display name |
| `avatar_url` | TEXT | Profile picture URL |
| `settings` | JSONB | User preferences/settings |
| `created_at` | TIMESTAMPTZ | Profile creation timestamp |
| `watchlist_movie_ids` | UUID[] | Array of movie IDs in user's watchlist |

**RLS Policies:**
- Users can view their own profile
- Users can insert their own profile
- Users can update their own profile

---

#### 6. **user_ratings**
User-submitted movie ratings and reviews.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `user_id` | UUID | Foreign key → profiles.user_id (ON DELETE CASCADE) |
| `movie_id` | UUID | Foreign key → movies.id (ON DELETE CASCADE) |
| `rating` | NUMERIC | User's rating (0-10) |
| `review` | TEXT | Written review (optional) |
| `rated_at` | TIMESTAMPTZ | When rating was submitted |

**Constraints:**
- Unique combination of `user_id` and `movie_id`
- Rating must be between 0 and 10

**RLS Policies:**
- Users can view their own ratings
- Users can insert their own ratings
- Users can update their own ratings
- Users can delete their own ratings

---

#### 7. **watch_history**
Tracks when users watch movies.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `user_id` | UUID | Foreign key → profiles.user_id (ON DELETE CASCADE) |
| `movie_id` | UUID | Foreign key → movies.id (ON DELETE CASCADE) |
| `watched_at` | TIMESTAMPTZ | When movie was watched |
| `context` | JSONB | Additional context (platform, device, etc.) |

**RLS Policies:**
- Users can view their own watch history
- Users can insert their own watch history
- Users can delete their own watch history

---

#### 8. **lists**
User-created movie lists (collections, favorites, etc.).

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `owner_id` | UUID | Foreign key → profiles.user_id (ON DELETE CASCADE) |
| `name` | TEXT | List name |
| `visibility` | TEXT | "private", "public", or "unlisted" |
| `movie_ids` | UUID[] | Array of movie IDs in the list |
| `created_at` | TIMESTAMPTZ | List creation timestamp |

**Constraints:**
- Visibility must be one of: "private", "public", "unlisted"

**RLS Policies:**
- Users can view their own lists
- Users can view public lists
- Users can insert their own lists
- Users can update their own lists
- Users can delete their own lists

---

## Row Level Security (RLS)

All tables containing user data have RLS enabled to ensure users can only access their own data:

### Public Data (Read-Only for All Users)
- `movies`
- `sources`
- `source_ratings`
- `blend_scores`

### User-Scoped Data
- `profiles` - Users can only view/edit their own profile
- `user_ratings` - Users have full CRUD access to their own ratings
- `watch_history` - Users can view/add/delete their own history (no update)
- `lists` - Users have full CRUD access to their own lists, can view public lists

---

## Foreign Key Relationships

```
movies
  ├─→ source_ratings (ON DELETE CASCADE)
  ├─→ user_ratings (ON DELETE CASCADE)
  ├─→ watch_history (ON DELETE CASCADE)
  ├─→ blend_scores (ON DELETE CASCADE)
  └─→ lists (via movie_ids array)

sources
  └─→ source_ratings (ON DELETE RESTRICT)

auth.users
  └─→ profiles (ON DELETE CASCADE)
       ├─→ user_ratings (ON DELETE CASCADE)
       ├─→ watch_history (ON DELETE CASCADE)
       └─→ lists (ON DELETE CASCADE)
```

---


## Triggers

### Auto-Update Timestamps
- `movies.updated_at` automatically updates on row modification
- Related data changes (ratings, scores) trigger movie timestamp updates

---

### 3. Create Test Users
- Go to Authentication → Users in Supabase Dashboard
- Add users manually or use the auth API
- Profiles will be created automatically via the auth trigger

### 4. Test RLS Policies
- Created one script that tests reading and inserting to different tables
- To test it, see backend/test_connections.py

---

## Best Practices

1. **Always use UUID for user-related tables** ✓
2. **Use TIMESTAMPTZ for all timestamps** ✓
3. **Enable RLS on user data tables** ✓
4. **Add check constraints for validation** ✓
5. **Index foreign keys and frequently queried columns** ✓
6. **Use CASCADE deletes for dependent data** ✓
7. **Use RESTRICT deletes for reference data** ✓

---

## Notes

- The `window` column in `blend_scores` is quoted because it's a PostgreSQL reserved keyword
- All JSONB columns have GIN indexes for efficient querying
- The schema uses `auth.users` from Supabase's built-in authentication
- RLS policies use `auth.uid()` to identify the current user
- Movie updates automatically trigger timestamp updates via database triggers

**********************************************************************************************************************************
WEEK 6 Documentation

# CineSync API

## What it Does
Our API interacts with supabase tables to implement business logic and allows users to update tables where RLS applies. This is done with FastAPI and adds business rules beyond database constraints, combines multiple supbase calls, and creates developer friendly endpoints.

## Setup
1. `pip install -r requirements.txt`
2. Add `.env` with Supabase credentials
3. `uvicorn main:app --reload`
4. Test at http://127.0.0.1:8000/docs

## Endpoints (at a minimum)
- `GET /movies` - List all movies
- `POST /movies` - Post new movie 
- `POST /watch_history` - Allows user to add new movie to their watch_history
- `GET /watch_history/count_rewatches` - Retrieves number of times user has watched specified movie
- `POST /user_ratings` - Post for user to input their rating of specified movie

## Key Business Rule
Endpoint 1: Get all movies from movies table
  - Simple get to display all movies in the movies table

Endpoint 2: Post to add movie to movies table
  - Accepts title (string), release_year (int), runtime_minutes (int), content_rating (string), poster_url (string)  as parameters

Endpoint 3: Post to add watched movie by user to watch_history table
  - User inputs a new movie that they watched which will then update the watch_history table for them

Endpoint 4: Get counted number of rewatches in watch_history table
  - Displays number of times a movie has been watched

Endpoint 5: Post for user to input their rating of the movie
  - Allows user to input their perceived score/rating of a movie

## Supabase API Understanding

Supabase API allows simple get and post methods to each table. 
Users are able to access records by querying by any table parameter/column.
Users are able to post to tables with requests containing complete formatted data.
This is inadequate for implementing business logic/math because there is no additional functionality provided.

---

## Frontend Setup

To run the CineSync React Native frontend:

1. Navigate to the frontend directory:
   ```bash
   cd playlist_frontend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Make sure you have **Xcode** and **Expo** properly installed and configured on your machine.

4. Run the iOS simulator:
   ```bash
   npm run ios
   ```

This will start the CineSync app locally in your iOS simulator with full mock data functionality and UI.

---

## Contributions and distribution of work

Soham: Created movie gallery and frontend base

Bryan: Created the search function for movies in the gallery

Ilias: Implemented sort function by movie release date

Jaime: Added the function for users to add a new movie to their gallery 

---

## Additional Features

### User Preferences & Personalization
- **Vibe Quiz**: Interactive onboarding quiz that generates a personalized preference vector for each user
- **Preference Vectors**: 10-dimensional vectors that capture user taste across multiple axes (mainstream vs arthouse, light vs dark, fast-paced vs slow-burn, etc.)
- **Movie Vibes**: Vector embeddings for movies that enable similarity-based recommendations

### Blend Recommendations
- **Multi-User Blending**: Generate movie recommendations based on combined preferences of multiple users
- **Smart Matching**: Uses cosine similarity between user preference vectors and movie vibe vectors
- **Genre-Based Results**: Recommendations organized by genre with personalized match percentages
- **Top Picks Rail**: Curated list of best matches for the group

### Social Features
- **User Relationships**: Follow/unfollow system with pending request management
- **Following Feed**: See users you follow and discover new users to connect with
- **Profile Views**: View other users' profiles, watchlists, and watch history
- **Follow Requests**: Accept or reject incoming follow requests via notification bell

### Movie Interactions
- **Watch History**: Track movies you've watched with timestamps
- **Reactions**: React to movies with like/meh/dislike and star ratings (1-5)
- **Reviews**: Write text reviews for movies you've watched
- **Watchlist**: Save movies to watch later with quick add/remove functionality

### Search & Discovery
- **Movie Search**: Real-time search with TMDB API integration for comprehensive movie database
- **User Search**: Find and connect with other users by display name
- **Auto-Ingestion**: Movies are automatically added to the database when searched

---

## Complete Setup Instructions

### Backend Setup

1. **Install Python dependencies**:
   ```bash
   cd backend
   pip install -r requirements.txt
   ```

2. **Configure environment variables**:
   Create a `.env` file in the `backend` directory with:
   ```env
   SUPABASE_URL=your_supabase_project_url
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
   TMDB_API_KEY=your_tmdb_api_key
   INGESTION_SECRET=your_secret_for_ingestion_endpoint
   ```

3. **Start the backend server**:
   ```bash
   python3 cine_api.py
   ```
   The server will run on `http://localhost:8000`

### Frontend Setup

1. **Navigate to frontend directory**:
   ```bash
   cd playlist_frontend
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure environment variables**:
   Create a `.env` file in the `playlist_frontend` directory with:
   ```env
   EXPO_PUBLIC_API_URL=http://localhost:8000
   EXPO_PUBLIC_SUPABASE_URL=your_supabase_project_url
   EXPO_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
   ```

4. **Run the iOS simulator**:
   ```bash
   npm run ios
   ```

### Prerequisites
- **Node.js** and **npm** installed
- **Python 3.7+** installed
- **Xcode** (for iOS development)
- **Expo CLI** (installed via npm)
- **Supabase** project with tables set up per schema
- **TMDB API key** (free at https://www.themoviedb.org/settings/api)

### Production Deployment
- Backend can be deployed to Railway, Heroku, or any platform supporting Python
- Frontend can be built with Expo EAS for iOS/Android app stores
- Update `EXPO_PUBLIC_API_URL` in frontend `.env` to point to production backend URL

---

## API Endpoints (Complete List)

### Movies
- `GET /movies` - List all movies
- `POST /movies` - Add new movie
- `POST /v1/movies/search` - Search TMDB and ingest movies
- `POST /v1/movies/{movie_id}/watch-and-react` - Record watch + rating + reaction

### User Preferences
- `POST /v1/preferences` - Submit quiz results and generate preference vector
- `POST /v1/preferences/batch` - Fetch preference vectors for multiple users

### Recommendations
- `POST /v1/blend/recommendations` - Generate blended recommendations for multiple users

### Social/Relationships
- `POST /v1/relationships/request` - Send follow request
- `POST /v1/relationships/respond` - Accept or reject follow request

### Watch History
- `POST /watch_history` - Add movie to watch history
- `GET /watch_history/count_rewatches` - Count rewatches for a movie

### User Ratings
- `POST /user_ratings` - Submit movie rating and review

---

## Database Tables (Additional)

### user_preferences
Stores user preference vectors from vibe quiz.

| Column | Type | Description |
|--------|------|-------------|
| `user_id` | UUID | Foreign key → profiles.user_id |
| `preference_vector` | FLOAT[] | 10-dimensional preference vector |
| `quiz_version` | TEXT | Version of quiz taken |
| `created_at` | TIMESTAMPTZ | When preferences were created |

### movie_vibes
Stores movie vibe vectors for similarity matching.

| Column | Type | Description |
|--------|------|-------------|
| `movie_id` | UUID | Foreign key → movies.id |
| `vibe_vector` | FLOAT[] | 10-dimensional vibe vector |
| `created_at` | TIMESTAMPTZ | When vibe was computed |

### user_relationships
Tracks follow relationships between users.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `user_id` | UUID | User initiating follow |
| `target_user_id` | UUID | User being followed |
| `status` | TEXT | "pending" or "accepted" |
| `created_at` | TIMESTAMPTZ | When relationship was created |

### user_movie_reactions
Stores user reactions to movies (like/meh/dislike).

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `user_id` | UUID | Foreign key → profiles.user_id |
| `movie_id` | UUID | Foreign key → movies.id |
| `rating` | INT | Star rating (1-5) |
| `reaction` | TEXT | "like", "meh", or "dislike" |
| `review` | TEXT | Optional text review |
| `created_at` | TIMESTAMPTZ | When reaction was recorded |
