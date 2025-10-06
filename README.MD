# Movie Database Schema

## Overview

This is a comprehensive movie rating and tracking database built for Supabase. It aggregates ratings from multiple sources (IMDb, Rotten Tomatoes, etc.), allows users to rate movies, track watch history, and create custom lists.

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

## Indexes

The schema includes indexes on:
- Foreign keys for join performance
- Frequently queried fields (title, release_year, ratings)
- JSONB columns using GIN indexes
- Array columns for list memberships
- Timestamp fields for sorting/filtering

---

## Triggers

### Auto-Update Timestamps
- `movies.updated_at` automatically updates on row modification
- Related data changes (ratings, scores) trigger movie timestamp updates

---

## Sample Queries

### Get movie with all its ratings
```sql
SELECT 
    m.title,
    m.release_year,
    s.name as source,
    sr.rating,
    sr.votes
FROM movies m
JOIN source_ratings sr ON m.id = sr.movie_id
JOIN sources s ON sr.source_id = s.id
WHERE m.id = 'movie-uuid-here'
ORDER BY s.name;
```

### Get top-rated movies by blend score
```sql
SELECT 
    m.title,
    m.release_year,
    bs.score,
    bs.source_count,
    bs.votes_weighted
FROM movies m
JOIN blend_scores bs ON m.id = bs.movie_id
WHERE bs.expires_at > NOW()
ORDER BY bs.score DESC
LIMIT 10;
```

### Get user's recent watch history
```sql
SELECT 
    m.title,
    m.poster_url,
    wh.watched_at,
    wh.context->>'platform' as platform
FROM watch_history wh
JOIN movies m ON wh.movie_id = m.id
WHERE wh.user_id = auth.uid()
ORDER BY wh.watched_at DESC
LIMIT 20;
```

### Get user's rated movies with their ratings
```sql
SELECT 
    m.title,
    ur.rating,
    ur.review,
    ur.rated_at
FROM user_ratings ur
JOIN movies m ON ur.movie_id = m.id
WHERE ur.user_id = auth.uid()
ORDER BY ur.rated_at DESC;
```

---

## Setup Instructions

### 1. Run the Schema
Copy the entire schema SQL and run it in the Supabase SQL Editor.

### 2. Load Sample Data
Use the provided sample data SQL to populate the database with test movies, sources, and ratings.

### 3. Create Test Users
- Go to Authentication → Users in Supabase Dashboard
- Add users manually or use the auth API
- Profiles will be created automatically via the auth trigger

### 4. Test RLS Policies
- Log in as different users
- Verify users can only see/modify their own data
- Confirm public data is accessible to all

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