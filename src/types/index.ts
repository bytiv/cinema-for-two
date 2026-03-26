export interface Profile {
  id: string;
  user_id: string;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  role: 'user' | 'admin';
  status: 'pending' | 'approved' | 'denied';
  bio: string | null;
  last_seen_at: string | null;
  hide_online_status: boolean;
  postcards_disabled: boolean;
  can_upload_torrent: boolean;
  subtitle_languages: string[];   // preferred subtitle language codes, e.g. ['en', 'ar']
  created_at: string;
  updated_at: string;
}

export interface PostcardShare {
  id: string;
  user_id: string;       // who is offering to share
  friend_id: string;     // who they're sharing with
  created_at: string;
}

export type VideoQuality = '480p' | '720p' | '1080p' | '4K';
export type IngestMethod = 'direct_upload' | 'torrent';

export interface QualityVariant {
  quality: VideoQuality;
  blob_name: string;
  blob_url: string;
  file_size: number;
  hls_playlist: string | null;  // blob name of byte-range .m3u8 for this quality (null if HLS disabled)
}

export type TorrentJobStage =
  | 'Fetching torrent info'
  | 'Downloading to servers'
  | 'Transcoding for playback'
  | 'Generating HLS'
  | 'Uploading to storage'
  | 'Ready'
  | 'Failed'
  | 'Cancelled';

export type TorrentJobErrorCode =
  | 'stall_timeout'
  | 'slow_start'
  | 'rate_kill'
  | 'upload_timeout'
  | 'hard_timeout'
  | 'no_file_found'
  | `aria2c_exit_${number}`
  | string;   // fallback for unexpected errors

export interface SubtitleTrack {
  label: string;
  lang: string;
  url: string;
}

export interface Movie {
  id: string;
  title: string;
  description: string | null;
  poster_url: string | null;
  blob_url: string;
  blob_name: string;
  file_size: number;
  duration: number | null;
  format: string;
  quality: VideoQuality | null;
  subtitles: SubtitleTrack[];
  // TMDB metadata
  tmdb_id: number | null;
  release_date: string | null;
  rating: number | null;
  genres: string[] | null;
  runtime: number | null;         // minutes (from TMDB)
  tagline: string | null;         // from TMDB
  imdb_id: string | null;         // from TMDB
  original_language: string | null; // from TMDB
  source_type: string | null;     // e.g. 'BluRay', 'WEB-DL', 'WEBRip'
  release_name: string | null;    // original torrent/release name for subtitle matching
  // Series metadata (null for movies)
  series_name: string | null;
  season_number: number | null;
  episode_number: number | null;
  episode_title: string | null;
  subtitle_options: Record<string, {
    candidates: { source_url: string; release_name: string; score: number; is_zip: boolean; source: string }[];
    downloaded: { url: string; release_name: string }[];
    active_index: number;
  }> | null;
  // Ingest provenance
  ingest_method: IngestMethod;
  info_hash: string | null;       // null for direct uploads
  ingest_job_id: string | null;   // null for direct uploads
  ingest_group_id: string | null; // groups multi-quality ingest jobs together
  uploaded_by: string;
  is_public: boolean;
  // Multi-quality & HLS
  quality_variants: QualityVariant[] | null;   // null = single-quality (legacy)
  hls_master_playlist: string | null;          // blob name of master .m3u8 (null if HLS disabled)
  created_at: string;
  updated_at: string;
  // Joined
  uploader?: Profile;
}

export interface TMDBSearchResult {
  tmdb_id: number;
  title: string;
  original_title: string;
  overview: string;
  poster_url: string | null;
  poster_path: string | null;
  release_date: string;
  year: number | null;
  rating: number;
  vote_count: number;
  genres: string[];
  language: string;
  media_type?: 'movie' | 'tv'; // from multi-search
}

export interface TMDBMovieDetail extends TMDBSearchResult {
  backdrop_url: string | null;
  runtime: number | null;
  tagline: string;
  imdb_id: string | null;
}

export interface TMDBTVDetail extends TMDBSearchResult {
  backdrop_url: string | null;
  tagline: string;
  number_of_seasons: number;
  number_of_episodes: number;
  seasons: TMDBSeason[];
  status: string;
}

export interface TMDBSeason {
  season_number: number;
  name: string;
  episode_count: number;
  air_date: string | null;
  poster_url: string | null;
}

export interface TMDBEpisode {
  episode_number: number;
  season_number: number;
  name: string;
  overview: string;
  air_date: string | null;
  runtime: number | null;
  still_url: string | null;
  rating: number;
  vote_count: number;
}

export interface TorrentSearchResult {
  name: string;
  hash: string;
  size: string;
  size_bytes: number;
  seeders: number;
  leechers: number;
  quality: string | null;
  source_type: string | null;
  codec: string | null;
  origin: string;
  magnet: string;
  score: number;
}

export interface TorrentJob {
  // Identity
  id: string;
  job_id: string;           // UUID from the Python ingest API
  requested_by: string;

  // Source
  info_hash: string;
  file_name: string | null;

  // Status
  stage: TorrentJobStage;
  error_code: TorrentJobErrorCode | null;
  notification: string | null;
  warning: string | null;   // non-fatal advisory — show as yellow banner

  // Download metrics
  download_percent: number;
  download_speed: string | null;   // e.g. "1.2MiB"
  download_eta: string | null;     // e.g. "5m"
  seeder_count: number | null;

  // Upload metrics
  upload_percent: number;

  // Result
  blob_url: string | null;
  movie_id: string | null;         // set once the movie row is created

  // Timing
  started_at: string;
  completed_at: string | null;
  duration_seconds: number | null; // computed by Postgres
}

export interface TorrentJobRequest {
  hash: string;             // bare InfoHash or full magnet URI
  name: string;             // desired filename without extension
  trackers?: string[];
  ingest_group_id?: string; // groups multi-quality jobs together
  assigned_quality?: VideoQuality; // which quality this job represents
  generate_hls?: boolean;   // whether to generate byte-range HLS playlist
}


export interface Postcard {
  id: string;
  user_id: string;
  image_url: string;
  blob_name: string;
  caption: string | null;
  position_index: number;
  created_at: string;
}

export interface WatchRoom {
  id: string;
  movie_id: string;
  host_user_id: string;
  is_active: boolean;
  current_time_seconds: number;
  is_playing: boolean;
  last_activity_at: string;
  suspended_at: string | null;
  created_at: string;
  // Joined
  movie?: Movie;
  host?: Profile;
}

export interface WatchRoomParticipant {
  id: string;
  room_id: string;
  user_id: string;
  joined_at: string;
  // Joined
  profile?: Profile;
}

export interface WatchHistory {
  id: string;
  user_id: string;
  movie_id: string;
  watched_with: string | null;
  progress_seconds: number;
  completed: boolean;
  watched_at: string;
  // Joined
  movie?: Movie;
  partner?: Profile;
}

export interface Friendship {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: 'pending' | 'accepted' | 'denied';
  created_at: string;
  updated_at: string;
  // Joined
  requester?: Profile;
  addressee?: Profile;
}

// Realtime payloads
export interface PlaybackEvent {
  type: 'play' | 'pause' | 'seek' | 'sync_request' | 'sync_response';
  user_id: string;
  user_name?: string;
  timestamp: number; // video current time in seconds
  server_time: number; // Date.now()
  playback_rate?: number;
}

export interface ChatMessage {
  id: string;
  user_id: string;
  user_name: string;
  avatar_url: string | null;
  message: string;
  type?: 'chat' | 'system';
  sent_at: number;
}

export interface PresenceState {
  user_id: string;
  user_name: string;
  avatar_url: string | null;
  online_at: string;
}