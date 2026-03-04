-- Add subtitles column to movies table
-- Each entry: { label: "English", lang: "en", url: "https://..." }
ALTER TABLE public.movies
  ADD COLUMN IF NOT EXISTS subtitles JSONB NOT NULL DEFAULT '[]'::jsonb;




-- TO ADD BIO
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT NULL;