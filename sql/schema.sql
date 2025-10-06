-- Extensions

create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";
create extension if not exists "plpgsql";
create extension if not exists "pg_graphql";
create extension if not exists "pg_stat_statements";


-- Tables

create table public.blend_scores (
  id uuid not null default extensions.uuid_generate_v4 (),
  movie_id uuid not null,
  algorithm_version text not null,
  region text null,
  "window" text null,
  score numeric not null,
  score_variance numeric null,
  ci_low numeric null,
  ci_high numeric null,
  votes_weighted integer null,
  source_count smallint null,
  inputs_snapshot jsonb null default '{}'::jsonb,
  computed_at timestamp with time zone not null default now(),
  expires_at timestamp with time zone null,
  notes text null,
  constraint blend_scores_pkey primary key (id),
  constraint blend_scores_movie_id_fkey foreign KEY (movie_id) references movies (id) on delete CASCADE,
  constraint blend_scores_score_valid check ((score >= (0)::numeric)),
  constraint blend_scores_source_count_positive check (
    (
      (source_count is null)
      or (source_count > 0)
    )
  ),
  constraint blend_scores_variance_non_negative check (
    (
      (score_variance is null)
      or (score_variance >= (0)::numeric)
    )
  ),
  constraint blend_scores_algorithm_not_empty check (
    (
      length(
        TRIM(
          both
          from
            algorithm_version
        )
      ) > 0
    )
  ),
  constraint blend_scores_votes_non_negative check (
    (
      (votes_weighted is null)
      or (votes_weighted >= 0)
    )
  ),
  constraint blend_scores_ci_valid check (
    (
      (ci_low is null)
      or (ci_high is null)
      or (ci_low <= ci_high)
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_blend_scores_movie_id on public.blend_scores using btree (movie_id) TABLESPACE pg_default;

create index IF not exists idx_blend_scores_algorithm_version on public.blend_scores using btree (algorithm_version) TABLESPACE pg_default;

create index IF not exists idx_blend_scores_region on public.blend_scores using btree (region) TABLESPACE pg_default;

create index IF not exists idx_blend_scores_computed_at on public.blend_scores using btree (computed_at) TABLESPACE pg_default;

create index IF not exists idx_blend_scores_expires_at on public.blend_scores using btree (expires_at) TABLESPACE pg_default;

create trigger blend_scores_notify_movie
after INSERT
or
update on blend_scores for EACH row
execute FUNCTION notify_movie_updated ();

create table public.movies (
  id uuid not null default extensions.uuid_generate_v4 (),
  title text not null,
  release_year smallint null,
  runtime_minutes smallint null,
  content_rating text null,
  poster_url text null,
  synopsis text null,
  external_ids jsonb null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint movies_pkey primary key (id),
  constraint movies_release_year_valid check (
    (
      (release_year is null)
      or (
        (release_year >= 1800)
        and (release_year <= 2100)
      )
    )
  ),
  constraint movies_runtime_positive check (
    (
      (runtime_minutes is null)
      or (runtime_minutes > 0)
    )
  ),
  constraint movies_title_not_empty check (
    (
      length(
        TRIM(
          both
          from
            title
        )
      ) > 0
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_movies_title on public.movies using btree (title) TABLESPACE pg_default;

create index IF not exists idx_movies_release_year on public.movies using btree (release_year) TABLESPACE pg_default;

create index IF not exists idx_movies_external_ids on public.movies using gin (external_ids) TABLESPACE pg_default;

create trigger movies_updated_at BEFORE
update on movies for EACH row
execute FUNCTION update_updated_at_column ();

create table public.profiles (
  user_id uuid not null,
  display_name text null,
  avatar_url text null,
  settings jsonb null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  watchlist_movie_ids uuid[] null,
  constraint profiles_pkey primary key (user_id),
  constraint profiles_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE,
  constraint profiles_display_name_length check (
    (
      (display_name is null)
      or (
        (
          length(
            TRIM(
              both
              from
                display_name
            )
          ) >= 1
        )
        and (
          length(
            TRIM(
              both
              from
                display_name
            )
          ) <= 100
        )
      )
    )
  )
) TABLESPACE pg_default;

create table public.profiles (
  user_id uuid not null,
  display_name text null,
  avatar_url text null,
  settings jsonb null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  watchlist_movie_ids uuid[] null,
  constraint profiles_pkey primary key (user_id),
  constraint profiles_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE,
  constraint profiles_display_name_length check (
    (
      (display_name is null)
      or (
        (
          length(
            TRIM(
              both
              from
                display_name
            )
          ) >= 1
        )
        and (
          length(
            TRIM(
              both
              from
                display_name
            )
          ) <= 100
        )
      )
    )
  )
) TABLESPACE pg_default;

create table public.sources (
  id uuid not null default extensions.uuid_generate_v4 (),
  name text not null,
  scale text not null,
  base_url text null,
  constraint sources_pkey primary key (id),
  constraint sources_name_key unique (name),
  constraint sources_name_not_empty check (
    (
      length(
        TRIM(
          both
          from
            name
        )
      ) > 0
    )
  ),
  constraint sources_scale_not_empty check (
    (
      length(
        TRIM(
          both
          from
            scale
        )
      ) > 0
    )
  )
) TABLESPACE pg_default;

create table public.user_ratings (
  id uuid not null default extensions.uuid_generate_v4 (),
  user_id uuid not null,
  movie_id uuid not null,
  rating numeric not null,
  review text null,
  rated_at timestamp with time zone not null default now(),
  constraint user_ratings_pkey primary key (id),
  constraint user_ratings_unique_user_movie unique (user_id, movie_id),
  constraint user_ratings_movie_id_fkey foreign KEY (movie_id) references movies (id) on delete CASCADE,
  constraint user_ratings_user_id_fkey foreign KEY (user_id) references profiles (user_id) on delete CASCADE,
  constraint user_ratings_rating_valid check (
    (
      (rating >= (0)::numeric)
      and (rating <= (10)::numeric)
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_user_ratings_user_id on public.user_ratings using btree (user_id) TABLESPACE pg_default;

create index IF not exists idx_user_ratings_movie_id on public.user_ratings using btree (movie_id) TABLESPACE pg_default;

create index IF not exists idx_user_ratings_rated_at on public.user_ratings using btree (rated_at) TABLESPACE pg_default;

create table public.watch_history (
  id uuid not null default extensions.uuid_generate_v4 (),
  user_id uuid not null,
  movie_id uuid not null,
  watched_at timestamp with time zone not null default now(),
  constraint watch_history_pkey primary key (id),
  constraint watch_history_movie_id_fkey foreign KEY (movie_id) references movies (id) on delete CASCADE,
  constraint watch_history_user_id_fkey foreign KEY (user_id) references profiles (user_id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_watch_history_watched_at on public.watch_history using btree (watched_at) TABLESPACE pg_default;

create index IF not exists idx_watch_history_user_id on public.watch_history using btree (user_id) TABLESPACE pg_default;

create index IF not exists idx_watch_history_movie_id on public.watch_history using btree (movie_id) TABLESPACE pg_default;

-- RLS

alter policy "Enable read access for all users"
on "public"."blend_scores"
to public
using (true);

alter policy "Enable read access for all users"
on "public"."movies"
to public
using (true);

alter policy "Users can insert their own profile"
on "public"."profiles"
to public
with check ((auth.uid() = user_id));

alter policy "Users can update their own profile"
on "public"."profiles"
to public
using ((auth.uid() = user_id));

alter policy "Users can view their own profile"
on "public"."profiles"
to public
using ((auth.uid() = user_id));

alter policy "Enable read access for all users"
on "public"."source_ratings"
to public
using (true);

alter policy "Enable insert for authenticated users only"
on "public"."sources"
to public
with check (true);

alter policy "Enable read access for all users"
on "public"."sources"
to public
using (true);

alter policy "Users can delete their own ratings"
on "public"."user_ratings"
to public
using ((auth.uid() = user_id));

alter policy "Users can insert their own ratings"
on "public"."user_ratings"
to public
with check ((auth.uid() = user_id));

alter policy "Users can update their own ratings"
on "public"."user_ratings"
to public
using ((auth.uid() = user_id));

alter policy "Users can view their own ratings"
on "public"."user_ratings"
to public
using ((auth.uid() = user_id));

alter policy "Users can delete their own watch history"
on "public"."watch_history"
to public
using ((auth.uid() = user_id));

alter policy "Users can insert their own watch history"
on "public"."watch_history"
to public
with check ((auth.uid() = user_id));

alter policy "Users can view their own watch history"
on "public"."watch_history"
to public
using ((auth.uid() = user_id));

-- Funtions

BEGIN
    UPDATE movies SET updated_at = NOW() WHERE id = NEW.movie_id;
    RETURN NEW;
END;

BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;