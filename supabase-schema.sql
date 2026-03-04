-- ============================================
-- 🎬 CinemaForTwo - FULL Database Schema (v3)
-- ============================================
-- FRESH INSTALL: Drop everything and run this in Supabase SQL Editor
-- (Dashboard → SQL Editor → New Query)
--
-- After running this, make yourself admin:
-- UPDATE public.profiles SET role = 'admin', status = 'approved'
--   WHERE user_id = 'YOUR_USER_ID_HERE';
-- ============================================


-- ============================================
-- 1. TABLES
-- ============================================

-- Profiles (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'user',           -- 'user' | 'admin'
  status TEXT NOT NULL DEFAULT 'pending',      -- 'pending' | 'approved' | 'denied'
  last_seen_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Movies (metadata only, actual files in Azure Blob)
CREATE TABLE IF NOT EXISTS public.movies (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  poster_url TEXT,
  blob_url TEXT NOT NULL,
  blob_name TEXT NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  duration INTEGER,               -- in seconds
  format TEXT NOT NULL DEFAULT 'mp4',
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Postcards (floating photos on home page)
CREATE TABLE IF NOT EXISTS public.postcards (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  image_url TEXT NOT NULL,
  blob_name TEXT NOT NULL,
  caption TEXT,
  position_index INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Watch Rooms (synchronized watching sessions)
CREATE TABLE IF NOT EXISTS public.watch_rooms (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  movie_id UUID REFERENCES public.movies(id) ON DELETE CASCADE NOT NULL,
  host_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  is_active BOOLEAN DEFAULT true NOT NULL,
  current_time_seconds FLOAT NOT NULL DEFAULT 0,
  is_playing BOOLEAN NOT NULL DEFAULT false,
  last_activity_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  suspended_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Watch Room Participants
CREATE TABLE IF NOT EXISTS public.watch_room_participants (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id UUID REFERENCES public.watch_rooms(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  joined_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(room_id, user_id)
);

-- Watch History
CREATE TABLE IF NOT EXISTS public.watch_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  movie_id UUID REFERENCES public.movies(id) ON DELETE CASCADE NOT NULL,
  watched_with UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  progress_seconds INTEGER DEFAULT 0 NOT NULL,
  completed BOOLEAN DEFAULT false NOT NULL,
  watched_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(user_id, movie_id)
);

-- Friendships
CREATE TABLE IF NOT EXISTS public.friendships (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  requester_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  addressee_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',      -- 'pending' | 'accepted' | 'denied'
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(requester_id, addressee_id),
  CHECK (requester_id != addressee_id)
);

-- Watch Invites (invite friends to join a watch session)
CREATE TABLE IF NOT EXISTS public.watch_invites (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id UUID NOT NULL,
  movie_id UUID REFERENCES public.movies(id) ON DELETE CASCADE NOT NULL,
  from_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  to_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(room_id, to_user_id)
);


-- ============================================
-- 2. INDEXES
-- ============================================

CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON public.profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_status ON public.profiles(status);
CREATE INDEX IF NOT EXISTS idx_movies_uploaded_by ON public.movies(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_movies_created_at ON public.movies(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_postcards_user_id ON public.postcards(user_id);
CREATE INDEX IF NOT EXISTS idx_watch_rooms_movie_id ON public.watch_rooms(movie_id);
CREATE INDEX IF NOT EXISTS idx_watch_rooms_active ON public.watch_rooms(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_watch_rooms_last_activity ON public.watch_rooms(last_activity_at);
CREATE INDEX IF NOT EXISTS idx_watch_history_user_id ON public.watch_history(user_id);
CREATE INDEX IF NOT EXISTS idx_watch_history_movie_id ON public.watch_history(movie_id);
CREATE INDEX IF NOT EXISTS idx_friendships_requester ON public.friendships(requester_id);
CREATE INDEX IF NOT EXISTS idx_friendships_addressee ON public.friendships(addressee_id);
CREATE INDEX IF NOT EXISTS idx_friendships_status ON public.friendships(status);
CREATE INDEX IF NOT EXISTS idx_watch_invites_to_user ON public.watch_invites(to_user_id);
CREATE INDEX IF NOT EXISTS idx_watch_invites_room ON public.watch_invites(room_id);
CREATE INDEX IF NOT EXISTS idx_watch_invites_status ON public.watch_invites(status);


-- ============================================
-- 3. ROW LEVEL SECURITY (RLS)
-- ============================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.movies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.postcards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.watch_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.watch_room_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.watch_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.watch_invites ENABLE ROW LEVEL SECURITY;

-- ---- PROFILES ----

CREATE POLICY "Profiles are viewable by all authenticated users"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can update any profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- ---- MOVIES ----

CREATE POLICY "Movies are viewable by all authenticated users"
  ON public.movies FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert movies"
  ON public.movies FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = uploaded_by);

CREATE POLICY "Users can update own movies"
  ON public.movies FOR UPDATE
  TO authenticated
  USING (auth.uid() = uploaded_by)
  WITH CHECK (auth.uid() = uploaded_by);

CREATE POLICY "Users can delete own movies"
  ON public.movies FOR DELETE
  TO authenticated
  USING (auth.uid() = uploaded_by);

-- ---- POSTCARDS ----

CREATE POLICY "Postcards viewable by all authenticated users"
  ON public.postcards FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert own postcards"
  ON public.postcards FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own postcards"
  ON public.postcards FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own postcards"
  ON public.postcards FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ---- WATCH ROOMS ----

CREATE POLICY "Watch rooms viewable by authenticated users"
  ON public.watch_rooms FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can create rooms"
  ON public.watch_rooms FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = host_user_id);

CREATE POLICY "Participants can update rooms"
  ON public.watch_rooms FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ---- WATCH ROOM PARTICIPANTS ----

CREATE POLICY "Participants viewable by authenticated users"
  ON public.watch_room_participants FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can join rooms"
  ON public.watch_room_participants FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can leave rooms"
  ON public.watch_room_participants FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ---- WATCH HISTORY ----

CREATE POLICY "Users can view own watch history"
  ON public.watch_history FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own watch history"
  ON public.watch_history FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own watch history"
  ON public.watch_history FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ---- FRIENDSHIPS ----

CREATE POLICY "Users can view their own friendships"
  ON public.friendships FOR SELECT
  TO authenticated
  USING (auth.uid() = requester_id OR auth.uid() = addressee_id);

CREATE POLICY "Users can send friend requests"
  ON public.friendships FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = requester_id);

CREATE POLICY "Users can update friendships they are part of"
  ON public.friendships FOR UPDATE
  TO authenticated
  USING (auth.uid() = addressee_id OR auth.uid() = requester_id);

CREATE POLICY "Users can delete their own friendships"
  ON public.friendships FOR DELETE
  TO authenticated
  USING (auth.uid() = requester_id OR auth.uid() = addressee_id);

-- ---- WATCH INVITES ----

CREATE POLICY "Users can send invites"
  ON public.watch_invites FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = from_user_id);

CREATE POLICY "Users can read their own invites"
  ON public.watch_invites FOR SELECT
  TO authenticated
  USING (auth.uid() = from_user_id OR auth.uid() = to_user_id);

CREATE POLICY "Recipient can update invite status"
  ON public.watch_invites FOR UPDATE
  TO authenticated
  USING (auth.uid() = to_user_id)
  WITH CHECK (auth.uid() = to_user_id);

CREATE POLICY "Users can delete their invites"
  ON public.watch_invites FOR DELETE
  TO authenticated
  USING (auth.uid() = from_user_id OR auth.uid() = to_user_id);


-- ============================================
-- 4. FUNCTIONS & TRIGGERS
-- ============================================

-- Auto-create profile on user signup
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

-- Auto-update updated_at timestamp
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


-- ============================================
-- 5. ENABLE REALTIME
-- ============================================

ALTER PUBLICATION supabase_realtime ADD TABLE public.watch_rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE public.watch_room_participants;
ALTER PUBLICATION supabase_realtime ADD TABLE public.friendships;
ALTER PUBLICATION supabase_realtime ADD TABLE public.watch_invites;


-- ============================================
-- DONE! 🎬
-- ============================================
-- Now make yourself admin:
--
--   UPDATE public.profiles
--   SET role = 'admin', status = 'approved'
--   WHERE user_id = 'YOUR_USER_ID_HERE';
--
-- ============================================