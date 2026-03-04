-- Add subtitles column to movies table
-- Each entry: { label: "English", lang: "en", url: "https://..." }
ALTER TABLE public.movies
  ADD COLUMN IF NOT EXISTS subtitles JSONB NOT NULL DEFAULT '[]'::jsonb;