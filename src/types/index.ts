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
  uploaded_by: string;
  created_at: string;
  updated_at: string;
  // Joined
  uploader?: Profile;
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