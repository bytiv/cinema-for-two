-- ============================================================
-- 🎬 CinemaForTwo — Full Database Schema (v4)
-- ============================================================
-- FRESH INSTALL: Drop everything and run this in Supabase SQL Editor
-- (Dashboard → SQL Editor → New Query)
--
-- If upgrading an existing DB, run migration_v4_torrent_ingest.sql instead.
--
-- After running, make yourself admin:
--   UPDATE public.profiles SET role = 'admin', status = 'approved'
--   WHERE user_id = 'YOUR_USER_ID_HERE';
-- ============================================================


-- ============================================================
-- 1. TABLES
-- ============================================================

-- Profiles (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id             UUID        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  first_name          TEXT        NOT NULL DEFAULT '',
  last_name           TEXT        NOT NULL DEFAULT '',
  avatar_url          TEXT,
  role                TEXT        NOT NULL DEFAULT 'user',        -- 'user' | 'admin'
  status              TEXT        NOT NULL DEFAULT 'pending',     -- 'pending' | 'approved' | 'denied'
  bio                 TEXT,
  last_seen_at        TIMESTAMPTZ DEFAULT now(),
  hide_online_status  BOOLEAN     NOT NULL DEFAULT false,
  postcards_disabled  BOOLEAN     NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at          TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Movies (metadata only — actual files live in Azure Blob Storage)
CREATE TABLE IF NOT EXISTS public.movies (
  id             UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  title          TEXT        NOT NULL,
  description    TEXT,
  poster_url     TEXT,
  blob_url       TEXT        NOT NULL,
  blob_name      TEXT        NOT NULL,
  file_size      BIGINT      NOT NULL DEFAULT 0,
  duration       INTEGER,                        -- seconds
  format         TEXT        NOT NULL DEFAULT 'mp4',
  quality        TEXT        CHECK (quality IN ('480p', '720p', '1080p', '4K')),
  subtitles      JSONB       NOT NULL DEFAULT '[]'::jsonb,
  -- Ingest provenance
  ingest_method  TEXT        NOT NULL DEFAULT 'direct_upload'
                               CHECK (ingest_method IN ('direct_upload', 'torrent')),
  info_hash      TEXT,                           -- NULL for direct uploads
  ingest_job_id  TEXT,                           -- NULL for direct uploads
  uploaded_by    UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at     TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Torrent ingest jobs — full audit trail of every ingest attempt
CREATE TABLE IF NOT EXISTS public.torrent_jobs (
  id            UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id        TEXT    NOT NULL UNIQUE,         -- UUID from the Python ingest API
  requested_by  UUID    REFERENCES auth.users(id) ON DELETE SET NULL,

  info_hash     TEXT    NOT NULL,                -- bare hash or magnet URI
  file_name     TEXT,                            -- final blob filename, set on completion

  stage TEXT NOT NULL DEFAULT 'Queued'
    CHECK (stage IN (
      'Queued',
      'Fetching torrent info',
      'Downloading to servers',
      'Uploading to storage',
      'Ready',
      'Failed',
      'Cancelled'
    )),
  error_code    TEXT,                            -- machine-readable e.g. 'stall_timeout'
  notification  TEXT,                            -- last human-readable status message
  warning       TEXT,                            -- last advisory message (non-fatal)

  download_percent  INTEGER DEFAULT 0,
  download_speed    TEXT,                        -- e.g. '1.2MiB'
  download_eta      TEXT,                        -- e.g. '5m'
  seeder_count      INTEGER,

  upload_percent    INTEGER DEFAULT 0,

  blob_url          TEXT,                        -- NULL unless stage = 'Ready'
  movie_id          UUID REFERENCES public.movies(id) ON DELETE SET NULL,

  started_at        TIMESTAMPTZ DEFAULT now() NOT NULL,
  completed_at      TIMESTAMPTZ,
  duration_seconds  INTEGER GENERATED ALWAYS AS (
    CASE
      WHEN completed_at IS NOT NULL
      THEN EXTRACT(EPOCH FROM (completed_at - started_at))::INTEGER
      ELSE NULL
    END
  ) STORED
);

-- Postcards (floating photos on the home page)
CREATE TABLE IF NOT EXISTS public.postcards (
  id             UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id        UUID        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  image_url      TEXT        NOT NULL,
  blob_name      TEXT        NOT NULL,
  caption        TEXT,
  position_index INTEGER     NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Postcard shares (controls which friends can see your postcards)
CREATE TABLE IF NOT EXISTS public.postcard_shares (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID        NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  friend_id  UUID        NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, friend_id)
);

-- Watch Rooms (synchronised watching sessions)
CREATE TABLE IF NOT EXISTS public.watch_rooms (
  id                   UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  movie_id             UUID        REFERENCES public.movies(id) ON DELETE CASCADE NOT NULL,
  host_user_id         UUID        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  is_active            BOOLEAN     DEFAULT true NOT NULL,
  current_time_seconds FLOAT       NOT NULL DEFAULT 0,
  is_playing           BOOLEAN     NOT NULL DEFAULT false,
  last_activity_at     TIMESTAMPTZ DEFAULT now() NOT NULL,
  suspended_at         TIMESTAMPTZ DEFAULT NULL,
  created_at           TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Watch Room Participants
CREATE TABLE IF NOT EXISTS public.watch_room_participants (
  id        UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id   UUID        REFERENCES public.watch_rooms(id) ON DELETE CASCADE NOT NULL,
  user_id   UUID        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  joined_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(room_id, user_id)
);

-- Watch History
CREATE TABLE IF NOT EXISTS public.watch_history (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id          UUID        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  movie_id         UUID        REFERENCES public.movies(id) ON DELETE CASCADE NOT NULL,
  watched_with     UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  progress_seconds INTEGER     DEFAULT 0 NOT NULL,
  completed        BOOLEAN     DEFAULT false NOT NULL,
  watched_at       TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(user_id, movie_id)
);

-- Friendships
CREATE TABLE IF NOT EXISTS public.friendships (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  requester_id UUID        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  addressee_id UUID        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'pending',   -- 'pending' | 'accepted' | 'denied'
  created_at   TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at   TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(requester_id, addressee_id),
  CHECK (requester_id != addressee_id)
);

-- Watch Invites
CREATE TABLE IF NOT EXISTS public.watch_invites (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id      UUID        NOT NULL,
  movie_id     UUID        REFERENCES public.movies(id) ON DELETE CASCADE NOT NULL,
  from_user_id UUID        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  to_user_id   UUID        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at   TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(room_id, to_user_id)
);


-- ============================================================
-- 2. INDEXES
-- ============================================================

-- profiles
CREATE INDEX IF NOT EXISTS idx_profiles_user_id  ON public.profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_status   ON public.profiles(status);

-- movies
CREATE INDEX IF NOT EXISTS idx_movies_uploaded_by    ON public.movies(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_movies_created_at     ON public.movies(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_movies_ingest_method  ON public.movies(ingest_method);
CREATE INDEX IF NOT EXISTS idx_movies_ingest_job_id  ON public.movies(ingest_job_id)
  WHERE ingest_job_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_movies_info_hash_unique ON public.movies(info_hash)
  WHERE info_hash IS NOT NULL;

-- torrent_jobs
CREATE INDEX IF NOT EXISTS idx_torrent_jobs_job_id        ON public.torrent_jobs(job_id);
CREATE INDEX IF NOT EXISTS idx_torrent_jobs_requested_by  ON public.torrent_jobs(requested_by);
CREATE INDEX IF NOT EXISTS idx_torrent_jobs_info_hash     ON public.torrent_jobs(info_hash);
CREATE INDEX IF NOT EXISTS idx_torrent_jobs_stage         ON public.torrent_jobs(stage);
CREATE INDEX IF NOT EXISTS idx_torrent_jobs_started_at    ON public.torrent_jobs(started_at DESC);

-- postcards
CREATE INDEX IF NOT EXISTS idx_postcards_user_id ON public.postcards(user_id);

-- watch_rooms
CREATE INDEX IF NOT EXISTS idx_watch_rooms_movie_id      ON public.watch_rooms(movie_id);
CREATE INDEX IF NOT EXISTS idx_watch_rooms_active        ON public.watch_rooms(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_watch_rooms_last_activity ON public.watch_rooms(last_activity_at);

-- watch_history
CREATE INDEX IF NOT EXISTS idx_watch_history_user_id  ON public.watch_history(user_id);
CREATE INDEX IF NOT EXISTS idx_watch_history_movie_id ON public.watch_history(movie_id);

-- friendships
CREATE INDEX IF NOT EXISTS idx_friendships_requester ON public.friendships(requester_id);
CREATE INDEX IF NOT EXISTS idx_friendships_addressee ON public.friendships(addressee_id);
CREATE INDEX IF NOT EXISTS idx_friendships_status    ON public.friendships(status);

-- watch_invites
CREATE INDEX IF NOT EXISTS idx_watch_invites_to_user ON public.watch_invites(to_user_id);
CREATE INDEX IF NOT EXISTS idx_watch_invites_room    ON public.watch_invites(room_id);
CREATE INDEX IF NOT EXISTS idx_watch_invites_status  ON public.watch_invites(status);


-- ============================================================
-- 3. ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE public.profiles                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.movies                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.torrent_jobs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.postcards               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.postcard_shares         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.watch_rooms             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.watch_room_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.watch_history           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friendships             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.watch_invites           ENABLE ROW LEVEL SECURITY;

-- ── PROFILES ──────────────────────────────────────────────────────────────────

CREATE POLICY "Profiles are viewable by all authenticated users"
  ON public.profiles FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can update any profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'admin'));

-- ── MOVIES ────────────────────────────────────────────────────────────────────

CREATE POLICY "Movies are viewable by all authenticated users"
  ON public.movies FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert movies"
  ON public.movies FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = uploaded_by);

CREATE POLICY "Users can update own movies"
  ON public.movies FOR UPDATE TO authenticated
  USING (auth.uid() = uploaded_by) WITH CHECK (auth.uid() = uploaded_by);

CREATE POLICY "Users can delete own movies"
  ON public.movies FOR DELETE TO authenticated
  USING (auth.uid() = uploaded_by);

-- ── TORRENT JOBS ──────────────────────────────────────────────────────────────

CREATE POLICY "Users can view own torrent jobs"
  ON public.torrent_jobs FOR SELECT TO authenticated
  USING (auth.uid() = requested_by);

CREATE POLICY "Admins can view all torrent jobs"
  ON public.torrent_jobs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'admin'));

CREATE POLICY "Users can insert own torrent jobs"
  ON public.torrent_jobs FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = requested_by);

CREATE POLICY "Users can update own torrent jobs"
  ON public.torrent_jobs FOR UPDATE TO authenticated
  USING (auth.uid() = requested_by) WITH CHECK (auth.uid() = requested_by);

CREATE POLICY "Admins can update any torrent job"
  ON public.torrent_jobs FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'admin'));

CREATE POLICY "Users can delete own terminal torrent jobs"
  ON public.torrent_jobs FOR DELETE TO authenticated
  USING (auth.uid() = requested_by AND stage IN ('Failed', 'Cancelled'));

-- ── POSTCARDS ─────────────────────────────────────────────────────────────────

CREATE POLICY "Postcards viewable by all authenticated users"
  ON public.postcards FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can insert own postcards"
  ON public.postcards FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own postcards"
  ON public.postcards FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own postcards"
  ON public.postcards FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ── POSTCARD SHARES ───────────────────────────────────────────────────────────

CREATE POLICY "Users manage own shares"
  ON public.postcard_shares FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can see shares directed at them"
  ON public.postcard_shares FOR SELECT USING (auth.uid() = friend_id);

-- ── WATCH ROOMS ───────────────────────────────────────────────────────────────

CREATE POLICY "Watch rooms viewable by authenticated users"
  ON public.watch_rooms FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can create rooms"
  ON public.watch_rooms FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = host_user_id);

CREATE POLICY "Participants can update rooms"
  ON public.watch_rooms FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ── WATCH ROOM PARTICIPANTS ───────────────────────────────────────────────────

CREATE POLICY "Participants viewable by authenticated users"
  ON public.watch_room_participants FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can join rooms"
  ON public.watch_room_participants FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can leave rooms"
  ON public.watch_room_participants FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- ── WATCH HISTORY ─────────────────────────────────────────────────────────────

CREATE POLICY "Users can view own watch history"
  ON public.watch_history FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own watch history"
  ON public.watch_history FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own watch history"
  ON public.watch_history FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── FRIENDSHIPS ───────────────────────────────────────────────────────────────

CREATE POLICY "Users can view their own friendships"
  ON public.friendships FOR SELECT TO authenticated
  USING (auth.uid() = requester_id OR auth.uid() = addressee_id);

CREATE POLICY "Users can send friend requests"
  ON public.friendships FOR INSERT TO authenticated WITH CHECK (auth.uid() = requester_id);

CREATE POLICY "Users can update friendships they are part of"
  ON public.friendships FOR UPDATE TO authenticated
  USING (auth.uid() = addressee_id OR auth.uid() = requester_id);

CREATE POLICY "Users can delete their own friendships"
  ON public.friendships FOR DELETE TO authenticated
  USING (auth.uid() = requester_id OR auth.uid() = addressee_id);

-- ── WATCH INVITES ─────────────────────────────────────────────────────────────

CREATE POLICY "Users can send invites"
  ON public.watch_invites FOR INSERT TO authenticated WITH CHECK (auth.uid() = from_user_id);

CREATE POLICY "Users can read their own invites"
  ON public.watch_invites FOR SELECT TO authenticated
  USING (auth.uid() = from_user_id OR auth.uid() = to_user_id);

CREATE POLICY "Recipient can update invite status"
  ON public.watch_invites FOR UPDATE TO authenticated
  USING (auth.uid() = to_user_id) WITH CHECK (auth.uid() = to_user_id);

CREATE POLICY "Users can delete their invites"
  ON public.watch_invites FOR DELETE TO authenticated
  USING (auth.uid() = from_user_id OR auth.uid() = to_user_id);


-- ============================================================
-- 4. FUNCTIONS & TRIGGERS
-- ============================================================

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (user_id, first_name, last_name, role, status)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    'user',
    'pending'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_profiles_updated_at ON public.profiles;
CREATE TRIGGER set_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_movies_updated_at ON public.movies;
CREATE TRIGGER set_movies_updated_at
  BEFORE UPDATE ON public.movies
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_friendships_updated_at ON public.friendships;
CREATE TRIGGER set_friendships_updated_at
  BEFORE UPDATE ON public.friendships
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Enforce max 3 postcards per user
CREATE OR REPLACE FUNCTION public.check_postcard_limit()
RETURNS trigger AS $$
BEGIN
  IF (SELECT COUNT(*) FROM public.postcards WHERE user_id = NEW.user_id) >= 3 THEN
    RAISE EXCEPTION 'Maximum of 3 postcards per user allowed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_postcard_limit ON public.postcards;
CREATE TRIGGER enforce_postcard_limit
  BEFORE INSERT ON public.postcards
  FOR EACH ROW EXECUTE FUNCTION public.check_postcard_limit();

-- Upsert torrent job — called by the Next.js API proxy on every SSE tick.
-- Creates the row on first call, merges safely on subsequent calls.
-- COALESCE guards ensure non-null values are never overwritten with null.
-- Sets completed_at automatically on transition to a terminal stage.
CREATE OR REPLACE FUNCTION public.upsert_torrent_job(
  p_job_id          TEXT,
  p_requested_by    UUID,
  p_info_hash       TEXT,
  p_file_name       TEXT     DEFAULT NULL,
  p_stage           TEXT     DEFAULT 'Queued',
  p_error_code      TEXT     DEFAULT NULL,
  p_notification    TEXT     DEFAULT NULL,
  p_warning         TEXT     DEFAULT NULL,
  p_download_pct    INTEGER  DEFAULT 0,
  p_download_speed  TEXT     DEFAULT NULL,
  p_download_eta    TEXT     DEFAULT NULL,
  p_seeder_count    INTEGER  DEFAULT NULL,
  p_upload_pct      INTEGER  DEFAULT 0,
  p_blob_url        TEXT     DEFAULT NULL,
  p_movie_id        UUID     DEFAULT NULL
)
RETURNS public.torrent_jobs
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  terminal_stages TEXT[] := ARRAY['Ready', 'Failed', 'Cancelled'];
  v_completed_at  TIMESTAMPTZ := NULL;
  result          public.torrent_jobs;
BEGIN
  IF p_stage = ANY(terminal_stages) THEN
    v_completed_at := now();
  END IF;

  INSERT INTO public.torrent_jobs (
    job_id, requested_by, info_hash, file_name,
    stage, error_code, notification, warning,
    download_percent, download_speed, download_eta, seeder_count,
    upload_percent, blob_url, movie_id,
    started_at, completed_at
  ) VALUES (
    p_job_id, p_requested_by, p_info_hash, p_file_name,
    p_stage, p_error_code, p_notification, p_warning,
    p_download_pct, p_download_speed, p_download_eta, p_seeder_count,
    p_upload_pct, p_blob_url, p_movie_id,
    now(), v_completed_at
  )
  ON CONFLICT (job_id) DO UPDATE SET
    file_name        = COALESCE(EXCLUDED.file_name,      torrent_jobs.file_name),
    stage            = EXCLUDED.stage,
    error_code       = COALESCE(EXCLUDED.error_code,     torrent_jobs.error_code),
    notification     = EXCLUDED.notification,
    warning          = EXCLUDED.warning,
    download_percent = EXCLUDED.download_percent,
    download_speed   = COALESCE(EXCLUDED.download_speed, torrent_jobs.download_speed),
    download_eta     = COALESCE(EXCLUDED.download_eta,   torrent_jobs.download_eta),
    seeder_count     = COALESCE(EXCLUDED.seeder_count,   torrent_jobs.seeder_count),
    upload_percent   = EXCLUDED.upload_percent,
    blob_url         = COALESCE(EXCLUDED.blob_url,       torrent_jobs.blob_url),
    movie_id         = COALESCE(EXCLUDED.movie_id,       torrent_jobs.movie_id),
    completed_at     = COALESCE(torrent_jobs.completed_at, EXCLUDED.completed_at)
  RETURNING * INTO result;

  RETURN result;
END;
$$;


-- ============================================================
-- 5. REALTIME
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE public.watch_rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE public.watch_room_participants;
ALTER PUBLICATION supabase_realtime ADD TABLE public.friendships;
ALTER PUBLICATION supabase_realtime ADD TABLE public.watch_invites;
ALTER PUBLICATION supabase_realtime ADD TABLE public.torrent_jobs;


CREATE TABLE container_state (
  id                  INTEGER PRIMARY KEY DEFAULT 1,
  container_ip        TEXT,
  container_starting  BOOLEAN DEFAULT false,
  updated_at          TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT single_row CHECK (id = 1)
);

-- Insert the single row
INSERT INTO container_state (id, container_ip, container_starting)
VALUES (1, null, false);

-- No RLS needed — only service_role touches this table
ALTER TABLE container_state ENABLE ROW LEVEL SECURITY;


CREATE TABLE ingest_jobs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  hash              TEXT NOT NULL,
  movie_name        TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending',
  error             TEXT,
  started_at        TIMESTAMPTZ,
  finished_at       TIMESTAMPTZ,
  last_heartbeat_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT valid_status CHECK (
    status IN (
      'pending',
      'submitted',
      'queued',
      'running',
      'uploading',
      'completed',
      'failed',
      'cancelled'
    )
  )
);

-- Index for fast per-user active job lookups
CREATE INDEX ingest_jobs_user_id_status_idx ON ingest_jobs (user_id, status);

-- Enable RLS
ALTER TABLE ingest_jobs ENABLE ROW LEVEL SECURITY;

-- Users can only see their own jobs
CREATE POLICY "users can view own jobs"
  ON ingest_jobs
  FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own jobs
CREATE POLICY "users can insert own jobs"
  ON ingest_jobs
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Service role bypasses RLS automatically (Python container uses this)

-- ============================================================
-- DONE ✅
-- ============================================================
-- Make yourself admin:
--   UPDATE public.profiles SET role = 'admin', status = 'approved'
--   WHERE user_id = 'YOUR_USER_ID_HERE';
-- ============================================================


ALTER TABLE ingest_jobs ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
UPDATE container_state SET container_ip = NULL, container_starting = false WHERE id = 1;



-- ═══════════════════════════════════════════════════════════════
-- CinemaForTwo — Public Movies + Ingest Metadata Migration
-- Run this in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- 1. Add is_public to movies
ALTER TABLE movies ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_movies_is_public ON movies(is_public) WHERE is_public = true;

-- 2. Add metadata to ingest_jobs (for the movie-save-on-Ready fix)
ALTER TABLE ingest_jobs ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- 3. RLS: ensure all authenticated users can SELECT public movies
-- (The existing "Movies are viewable by all authenticated users" policy
--  already uses USING(true), so public movies are already readable.
--  If you ever tighten that policy, uncomment the line below.)
--
-- CREATE POLICY "Anyone can view public movies"
--   ON public.movies FOR SELECT TO authenticated
--   USING (is_public = true);