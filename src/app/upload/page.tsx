'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import Navbar from '@/components/layout/Navbar';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { cn } from '@/lib/utils';
import { formatFileSize, generateBlobName, getVideoMimeType, formatDuration } from '@/lib/utils';
import { VideoQuality } from '@/types';
import type { TorrentJob } from '@/types';
import {
  Upload, Film, Image as ImageIcon, X, CheckCircle, AlertCircle,
  Plus, Globe, Gauge, Clock, Hash, Magnet, Download, HardDrive,
  Users, Zap, Ban, Loader2, ArrowRight, AlertTriangle, FolderOpen,
  Server, Wifi, WifiOff, Search, Star, Calendar, Tag,
} from 'lucide-react';
import type { TMDBSearchResult, TMDBMovieDetail, TorrentSearchResult } from '@/types';

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const ACCEPTED_VIDEO    = '.mp4,.mkv,.avi,.mov,.webm,.wmv,.m4v';
const ACCEPTED_IMAGE    = '.jpg,.jpeg,.png,.webp,.gif';
const ACCEPTED_SUBTITLE = '.srt,.vtt';
const MAX_POSTER_SIZE   = 10 * 1024 * 1024;

const LANGUAGE_OPTIONS = [
  { code: 'en', label: 'English'    },
  { code: 'ar', label: 'Arabic'     },
  { code: 'fr', label: 'French'     },
  { code: 'es', label: 'Spanish'    },
  { code: 'de', label: 'German'     },
  { code: 'it', label: 'Italian'    },
  { code: 'ja', label: 'Japanese'   },
  { code: 'ko', label: 'Korean'     },
  { code: 'zh', label: 'Chinese'    },
  { code: 'pt', label: 'Portuguese' },
  { code: 'ru', label: 'Russian'    },
  { code: 'tr', label: 'Turkish'    },
];

const QUALITY_OPTIONS: { value: VideoQuality; label: string; desc: string }[] = [
  { value: '480p',  label: '480p',  desc: 'SD'       },
  { value: '720p',  label: '720p',  desc: 'HD'       },
  { value: '1080p', label: '1080p', desc: 'Full HD'  },
  { value: '4K',    label: '4K',    desc: 'Ultra HD' },
];

type Tab = 'direct' | 'torrent' | 'search' | 'jobs';

// ─────────────────────────────────────────────────────────────
// Submit phase — shown instead of the spinner label
// ─────────────────────────────────────────────────────────────

type SubmitPhase =
  | 'idle'
  | 'checking-size'      // checking torrent size before anything else
  | 'uploading-poster'   // uploading poster to Azure
  | 'uploading-subs'     // uploading subtitles to Azure
  | 'service-check'      // checking if container is alive
  | 'service-starting'   // container is cold — starting up
  | 'service-connecting' // container started, waiting for health
  | 'submitting'         // sending job to Python
  | 'done';

const PHASE_LABELS: Record<SubmitPhase, string> = {
  idle:                '',
  'checking-size':     'Checking torrent size...',
  'uploading-poster':  'Uploading poster...',
  'uploading-subs':    'Uploading subtitles...',
  'service-check':     'Checking service status...',
  'service-starting':  'Starting up the service...',
  'service-connecting':'Connecting you to the server...',
  submitting:          'Preparing your request...',
  done:                'Done!',
};

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface SubtitleEntry {
  id: string; file: File; lang: string; label: string;
}

interface ActiveJob {
  jobId:      string;
  title:      string;
  hash:       string;
  job:        TorrentJob | null;
  streamMeta: {
    description?: string;
    quality?:     string;
    posterUrl?:   string;
    subtitles?:   { label: string; lang: string; url: string }[];
  };
  startedAt:  number;
  movieId?:   string;
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

const TERMINAL = new Set(['Ready', 'Failed', 'Cancelled']);

function stageColor(stage: string) {
  if (stage === 'Ready')                    return 'text-cinema-success bg-cinema-success/10 border-cinema-success/20';
  if (stage === 'Failed')                   return 'text-cinema-error bg-cinema-error/10 border-cinema-error/20';
  if (stage === 'Cancelled')                return 'text-cinema-text-dim bg-cinema-card border-cinema-border';
  if (stage === 'Uploading to storage')     return 'text-cinema-warm bg-cinema-warm/10 border-cinema-warm/20';
  if (stage === 'Transcoding for playback') return 'text-purple-400 bg-purple-400/10 border-purple-400/20';
  return 'text-cinema-secondary bg-cinema-secondary/10 border-cinema-secondary/20';
}

function stageIcon(stage: string) {
  if (stage === 'Ready')                    return <CheckCircle className="w-3.5 h-3.5" />;
  if (stage === 'Failed')                   return <AlertCircle className="w-3.5 h-3.5" />;
  if (stage === 'Cancelled')                return <Ban className="w-3.5 h-3.5" />;
  if (stage === 'Uploading to storage')     return <HardDrive className="w-3.5 h-3.5" />;
  if (stage === 'Downloading to servers')   return <Download className="w-3.5 h-3.5" />;
  if (stage === 'Transcoding for playback') return <Zap className="w-3.5 h-3.5" />;
  return <Loader2 className="w-3.5 h-3.5 animate-spin" />;
}

// ─────────────────────────────────────────────────────────────
// Sub-component: Submit phase banner
// ─────────────────────────────────────────────────────────────

function SubmitPhaseBanner({ phase }: { phase: SubmitPhase }) {
  if (phase === 'idle' || phase === 'done') return null;

  const isServicePhase = phase === 'service-check' || phase === 'service-starting' || phase === 'service-connecting';
  const isSizePhase = phase === 'checking-size';

  return (
    <div className={cn(
      'flex items-center gap-3 p-4 rounded-xl border transition-all duration-300',
      isServicePhase
        ? 'bg-cinema-secondary/8 border-cinema-secondary/20'
        : isSizePhase
        ? 'bg-cinema-warm/8 border-cinema-warm/20'
        : 'bg-cinema-accent/8 border-cinema-accent/20',
    )}>
      <div className="flex-shrink-0">
        {phase === 'checking-size'      && <HardDrive className="w-4 h-4 text-cinema-warm animate-pulse" />}
        {phase === 'service-starting'   && <Server className="w-4 h-4 text-cinema-secondary animate-pulse" />}
        {phase === 'service-connecting' && <Wifi   className="w-4 h-4 text-cinema-secondary animate-pulse" />}
        {phase === 'service-check'      && <Loader2 className="w-4 h-4 text-cinema-secondary animate-spin" />}
        {!isServicePhase && !isSizePhase && <Loader2 className="w-4 h-4 text-cinema-accent animate-spin" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className={cn(
          'text-sm font-medium',
          isServicePhase ? 'text-cinema-secondary' : isSizePhase ? 'text-cinema-warm' : 'text-cinema-accent',
        )}>
          {PHASE_LABELS[phase]}
        </p>
        {phase === 'checking-size' && (
          <p className="text-xs text-cinema-text-dim mt-0.5">
            Verifying the torrent doesn&apos;t exceed the size limit
          </p>
        )}
        {phase === 'service-starting' && (
          <p className="text-xs text-cinema-text-dim mt-0.5">
            This takes about 20–30 seconds on a cold start
          </p>
        )}
        {phase === 'service-connecting' && (
          <p className="text-xs text-cinema-text-dim mt-0.5">
            Almost there — running health checks
          </p>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Sub-component: Job Card
// ─────────────────────────────────────────────────────────────

function JobCard({
  activeJob,
  onCancel,
  onGoToMovie,
}: {
  activeJob:   ActiveJob;
  onCancel:    (jobId: string) => void;
  onGoToMovie: (movieId: string) => void;
}) {
  const { job, title, hash } = activeJob;
  const stage      = job?.stage ?? 'Fetching torrent info';
  const isTerminal = TERMINAL.has(stage);

  return (
    <div className={cn(
      'rounded-2xl border bg-cinema-card/60 backdrop-blur-sm overflow-hidden transition-all duration-300',
      stage === 'Ready'  ? 'border-cinema-success/30' :
      stage === 'Failed' ? 'border-cinema-error/30'   : 'border-cinema-border',
    )}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 p-4 pb-3">
        <div className="flex-1 min-w-0">
          <p className="font-medium text-cinema-text truncate">{title}</p>
          <p className="text-xs text-cinema-text-dim font-mono mt-0.5 truncate">{hash.slice(0, 40)}</p>
        </div>
        <span className={cn(
          'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium flex-shrink-0',
          stageColor(stage),
        )}>
          {stageIcon(stage)}
          {stage === 'Transcoding for playback' ? 'Optimizing' : stage}
        </span>
      </div>

      {/* Warning banner */}
      {job?.warning && (
        <div className="mx-4 mb-3 flex items-start gap-2.5 p-3 rounded-xl bg-cinema-warm/8 border border-cinema-warm/20">
          <AlertTriangle className="w-4 h-4 text-cinema-warm flex-shrink-0 mt-0.5" />
          <p className="text-xs text-cinema-warm leading-relaxed">{job.warning}</p>
        </div>
      )}

      {/* Notification */}
      {job?.notification && (
        <p className="px-4 pb-3 text-sm text-cinema-text-muted">{job.notification}</p>
      )}

      {/* Progress bars */}
      {job && !isTerminal && (
        <div className="px-4 pb-3 space-y-3">
          {/* Download */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-cinema-text-dim">
                <Download className="w-3 h-3" /> Download
              </span>
              <div className="flex items-center gap-3 text-cinema-text-muted">
                {job.download_speed && <span>{job.download_speed}</span>}
                {job.download_eta   && (
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />{job.download_eta}
                  </span>
                )}
                {job.seeder_count != null && job.download_percent < 100 && (
                  <span className={cn(
                    'flex items-center gap-1',
                    job.seeder_count === 0 ? 'text-cinema-error' :
                    job.seeder_count <= 3  ? 'text-cinema-warm'  : 'text-cinema-success',
                  )}>
                    <Users className="w-3 h-3" />{job.seeder_count}
                  </span>
                )}
                <span className="font-mono text-cinema-accent">{job.download_percent}%</span>
              </div>
            </div>
            <div className="h-1.5 bg-cinema-surface rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-cinema-secondary to-cinema-accent rounded-full transition-all duration-700 ease-out"
                style={{ width: `${job.download_percent}%` }}
              />
            </div>
          </div>

          {/* Upload */}
          {(job.stage === 'Uploading to storage' || job.upload_percent > 0) && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 text-cinema-text-dim">
                  <HardDrive className="w-3 h-3" /> Upload to storage
                </span>
                <span className="font-mono text-cinema-warm">{job.upload_percent}%</span>
              </div>
              <div className="h-1.5 bg-cinema-surface rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-cinema-warm to-cinema-accent-light rounded-full transition-all duration-700 ease-out"
                  style={{ width: `${job.upload_percent}%` }}
                />
              </div>
            </div>
          )}

          {/* Optimizing — shown during transcoding stage */}
          {job.stage === 'Transcoding for playback' && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 text-cinema-text-dim">
                  <Zap className="w-3 h-3" /> Optimizing for playback
                </span>
                <span className="font-mono text-purple-400">
                  <Loader2 className="w-3 h-3 animate-spin inline mr-1" />
                  Converting
                </span>
              </div>
              <div className="h-1.5 bg-cinema-surface rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-purple-500 to-purple-400 rounded-full transition-all duration-700 ease-out animate-pulse"
                  style={{ width: '100%' }}
                />
              </div>
              <p className="text-[11px] text-cinema-text-dim">
                Making sure the audio and video work perfectly in your browser — usually takes a few seconds
              </p>
            </div>
          )}
        </div>
      )}

      {/* Footer actions */}
      <div className="flex items-center gap-2 px-4 pb-4">
        {stage === 'Ready' && activeJob.movieId && (
          <Button
            size="sm" variant="primary"
            icon={<ArrowRight className="w-3.5 h-3.5" />}
            onClick={() => onGoToMovie(activeJob.movieId!)}
            className="flex-1"
          >
            Watch now
          </Button>
        )}
        {stage === 'Failed' && (
          <p className="text-xs text-cinema-error flex items-center gap-1.5 flex-1">
            <AlertCircle className="w-3.5 h-3.5" /> {job?.error_code ?? job?.notification ?? 'Unknown error'}
          </p>
        )}
        {!isTerminal && (
          <Button
            size="sm" variant="danger"
            icon={<Ban className="w-3.5 h-3.5" />}
            onClick={() => onCancel(activeJob.jobId)}
            className={stage === 'Ready' ? '' : 'flex-1'}
          >
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────

export default function UploadPage() {
  const router   = useRouter();
  const supabase = createClient();

  // ── Tab state ──────────────────────────────────────────────
  const [tab, setTab] = useState<Tab>('search');

  // ── Permission state ────────────────────────────────────────
  const [canTorrent, setCanTorrent] = useState(false);

  // ── Direct upload state ────────────────────────────────────
  const [movieFile,        setMovieFile]        = useState<File | null>(null);
  const [posterFile,       setPosterFile]       = useState<File | null>(null);
  const [posterPreview,    setPosterPreview]    = useState<string | null>(null);
  const [title,            setTitle]            = useState('');
  const [description,      setDescription]      = useState('');
  const [quality,          setQuality]          = useState<VideoQuality | null>(null);
  const [duration,         setDuration]         = useState<number | null>(null);
  const [detectedDuration, setDetectedDuration] = useState<number | null>(null);
  const [subtitleEntries,  setSubtitleEntries]  = useState<SubtitleEntry[]>([]);
  const [uploading,        setUploading]        = useState(false);
  const [uploadProgress,   setUploadProgress]   = useState(0);
  const [uploadStage,      setUploadStage]      = useState('');
  const [directError,      setDirectError]      = useState('');
  const [dragActive,       setDragActive]       = useState(false);

  // ── Torrent state ──────────────────────────────────────────
  const [hashInput,            setHashInput]            = useState('');
  const [torrentTitle,         setTorrentTitle]         = useState('');
  const [torrentDesc,          setTorrentDesc]          = useState('');
  const [torrentQuality,       setTorrentQuality]       = useState<VideoQuality | null>(null);
  const [torrentSubtitles,     setTorrentSubtitles]     = useState<SubtitleEntry[]>([]);
  const [torrentPosterFile,    setTorrentPosterFile]    = useState<File | null>(null);
  const [torrentPosterPreview, setTorrentPosterPreview] = useState<string | null>(null);
  const [torrentError,         setTorrentError]         = useState('');
  const [submitPhase,          setSubmitPhase]          = useState<SubmitPhase>('idle');
  const [torrentReleaseDate,   setTorrentReleaseDate]   = useState('');
  const [torrentRating,        setTorrentRating]        = useState('');
  const [torrentGenres,        setTorrentGenres]        = useState('');
  const [torrentRuntime,       setTorrentRuntime]       = useState('');
  const [torrentSourceType,    setTorrentSourceType]    = useState('');
  const [torrentImdbId,        setTorrentImdbId]        = useState('');
  const [torrentTagline,       setTorrentTagline]       = useState('');
  const [torrentLanguage,      setTorrentLanguage]      = useState('');

  // ── Subtitle language preference state ──────────────────────
  const [subtitleSecondLang,   setSubtitleSecondLang]   = useState<string>('');
  const [subtitleLangSaved,    setSubtitleLangSaved]    = useState(false);

  // ── TMDB search state ───────────────────────────────────────
  const [tmdbQuery,         setTmdbQuery]         = useState('');
  const [tmdbResults,       setTmdbResults]       = useState<TMDBSearchResult[]>([]);
  const [tmdbSearching,     setTmdbSearching]     = useState(false);
  const [tmdbError,         setTmdbError]         = useState('');
  const [selectedTmdb,      setSelectedTmdb]      = useState<TMDBMovieDetail | null>(null);
  const [tmdbLoadingDetail, setTmdbLoadingDetail] = useState(false);
  const [tmdbQuality,       setTmdbQuality]       = useState<VideoQuality | null>(null);
  const tmdbSearchTimer     = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Torrent source search state ─────────────────────────────
  const [allTorrentResults,    setAllTorrentResults]    = useState<TorrentSearchResult[]>([]); // full unfiltered cache
  const [torrentSearchResults, setTorrentSearchResults] = useState<TorrentSearchResult[]>([]);
  const [torrentSearching,     setTorrentSearching]     = useState(false);
  const [torrentSearchError,   setTorrentSearchError]   = useState('');

  // ── Active jobs state ──────────────────────────────────────
  const [activeJobs, setActiveJobs] = useState<ActiveJob[]>([]);
  const esRefs = useRef<Record<string, EventSource>>({});

  // ── Restore in-progress jobs from Supabase on mount ───────
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Check torrent upload permission
      const { data: profile } = await supabase
        .from('profiles')
        .select('role, can_upload_torrent')
        .eq('user_id', user.id)
        .single();
      if (profile) {
        setCanTorrent(profile.role === 'admin' || profile.can_upload_torrent === true);
      }

      // Load subtitle language preference
      const { data: fullProfile } = await supabase
        .from('profiles')
        .select('subtitle_languages')
        .eq('user_id', user.id)
        .single();
      if (fullProfile?.subtitle_languages) {
        const langs: string[] = fullProfile.subtitle_languages;
        const secondLang = langs.find((l: string) => l !== 'en') || '';
        setSubtitleSecondLang(secondLang);
        if (secondLang) setSubtitleLangSaved(true);
      }

      const { data: rows } = await supabase
        .from('ingest_jobs')
        .select('*')
        .eq('user_id', user.id)
        .in('status', ['pending', 'submitted', 'running', 'uploading'])
        .order('created_at', { ascending: false });

      if (!rows?.length) return;

      const STALE_MS = 2 * 60 * 60 * 1000; // 2 hours
      const now = Date.now();

      const restored: ActiveJob[] = [];
      const staleIds: string[] = [];

      for (const r of rows) {
        const age = now - new Date(r.created_at).getTime();
        const heartbeatAge = r.last_heartbeat_at
          ? now - new Date(r.last_heartbeat_at).getTime()
          : age;

        // If the job has been sitting without a heartbeat for over 2 hours, it's stale
        if (heartbeatAge > STALE_MS) {
          staleIds.push(r.id);
          continue;
        }

        restored.push({
          jobId:      r.id,
          title:      r.movie_name,
          hash:       r.hash,
          job:        null,
          streamMeta: {},
          startedAt:  new Date(r.created_at).getTime(),
          movieId:    undefined,
        });
      }

      // Mark stale jobs as failed so they don't linger forever
      if (staleIds.length > 0) {
        await supabase
          .from('ingest_jobs')
          .update({ status: 'failed', error: 'Job timed out — no heartbeat received', finished_at: new Date().toISOString() })
          .in('id', staleIds);
      }

      if (!restored.length) return;

      setActiveJobs(restored);
      setTab('jobs');
      restored.forEach((aj) => _attachStream(aj.jobId, aj.title, aj.streamMeta));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Cleanup EventSources and poll intervals on unmount ──
  useEffect(() => {
    return () => {
      Object.values(esRefs.current).forEach((es) => es.close());
      Object.values(pollIntervals.current).forEach((id) => clearInterval(id));
    };
  }, []);

  // ─────────────────────────────────────────────────────────
  // SSE stream attachment with polling fallback
  // ─────────────────────────────────────────────────────────
  const pollIntervals = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  function _startPolling(jobId: string) {
    if (pollIntervals.current[jobId]) return;

    let consecutiveErrors = 0;

    const poll = async () => {
      try {
        const res = await fetch(`/api/ingest/status/${jobId}`);

        if (!res.ok || res.status === 502 || res.status === 503) {
          // Python container is likely down — fall back to Supabase
          consecutiveErrors++;
          if (consecutiveErrors >= 3) {
            await _pollSupabaseFallback(jobId);
          }
          return;
        }

        const data = await res.json();

        // If the status endpoint returned an error (container doesn't know this job),
        // fall back to checking Supabase directly
        if (data.error) {
          consecutiveErrors++;
          if (consecutiveErrors >= 2) {
            await _pollSupabaseFallback(jobId);
          }
          return;
        }

        // Got a real status from the Python container
        consecutiveErrors = 0;
        const job: TorrentJob & { movie_id?: string } = data;

        setActiveJobs((prev) =>
          prev.map((aj) =>
            aj.jobId === jobId
              ? { ...aj, job, movieId: job.movie_id ?? aj.movieId }
              : aj,
          ),
        );

        if (TERMINAL.has(job.stage)) {
          clearInterval(pollIntervals.current[jobId]);
          delete pollIntervals.current[jobId];
          setTab('jobs');
        }
      } catch {
        consecutiveErrors++;
        if (consecutiveErrors >= 3) {
          await _pollSupabaseFallback(jobId);
        }
      }
    };

    // Poll immediately, then every 3 seconds
    poll();
    pollIntervals.current[jobId] = setInterval(poll, 3000);
  }

  /** When the Python container is gone, check ingest_jobs in Supabase for the real status */
  async function _pollSupabaseFallback(jobId: string) {
    try {
      const { data: row, error } = await supabase
        .from('ingest_jobs')
        .select('status, error, movie_name')
        .eq('id', jobId)
        .single();

      if (error || !row) return;

      const statusToStage: Record<string, string> = {
        completed:    'Ready',
        failed:       'Failed',
        cancelled:    'Cancelled',
        running:      'Downloading to servers',
        transcoding:  'Transcoding for playback',
        uploading:    'Uploading to storage',
        submitted:    'Fetching torrent info',
        pending:      'Fetching torrent info',
      };

      const stage = statusToStage[row.status] ?? 'Fetching torrent info';

      setActiveJobs((prev) =>
        prev.map((aj) =>
          aj.jobId === jobId
            ? {
                ...aj,
                job: {
                  job_id: jobId,
                  info_hash: aj.hash,
                  stage,
                  download_percent: stage === 'Ready' ? 100 : (aj.job?.download_percent ?? 0),
                  upload_percent: stage === 'Ready' ? 100 : (aj.job?.upload_percent ?? 0),
                  notification: row.error ?? (stage === 'Ready' ? 'Download complete' : undefined),
                  error_code: stage === 'Failed' ? 'container_lost' : undefined,
                } as TorrentJob,
              }
            : aj,
        ),
      );

      if (['Ready', 'Failed', 'Cancelled'].includes(stage)) {
        _stopPolling(jobId);
        setTab('jobs');
      }
    } catch {}
  }

  function _stopPolling(jobId: string) {
    if (pollIntervals.current[jobId]) {
      clearInterval(pollIntervals.current[jobId]);
      delete pollIntervals.current[jobId];
    }
  }

  function _attachStream(
    jobId: string,
    title: string,
    meta:  ActiveJob['streamMeta'],
  ) {
    if (esRefs.current[jobId]) return;

    let receivedRealEvent = false;

    // Start polling as a fallback immediately — SSE will take over if it works
    _startPolling(jobId);

    // Stream goes through our Next.js proxy route
    const es = new EventSource(`/api/ingest/status/${jobId}/stream`);
    esRefs.current[jobId] = es;

    es.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data);

        // Handle error events from the stream route
        if (parsed.error) {
          es.close();
          delete esRefs.current[jobId];
          // Don't mark as failed — let polling continue to get real status
          // Only mark failed if polling is also not getting results
          return;
        }

        // We got a real event — stop polling, SSE is working
        if (!receivedRealEvent) {
          receivedRealEvent = true;
          _stopPolling(jobId);
        }

        const job: TorrentJob & { movie_id?: string } = parsed;
        setActiveJobs((prev) =>
          prev.map((aj) =>
            aj.jobId === jobId
              ? { ...aj, job, movieId: job.movie_id ?? aj.movieId }
              : aj,
          ),
        );
        if (TERMINAL.has(job.stage)) {
          es.close();
          delete esRefs.current[jobId];
          _stopPolling(jobId);
          setTab('jobs');
        }
      } catch {}
    };

    let retryCount = 0;
    const MAX_RETRIES = 1;

    es.onerror = () => {
      es.close();
      delete esRefs.current[jobId];

      // Polling is still running as fallback, so don't mark as failed immediately.
      // Only retry SSE once — polling will carry the load.
      if (retryCount < MAX_RETRIES) {
        retryCount++;
        setTimeout(() => {
          _attachStream(jobId, title, meta);
        }, 5000);
      }
      // If SSE keeps failing, polling continues — no need to show error
    };
  }

  // ─────────────────────────────────────────────────────────
  // Subtitle helpers
  // ─────────────────────────────────────────────────────────
  const srtToVtt = async (file: File): Promise<Blob> => {
    const text = await file.text();
    const vtt  = 'WEBVTT\n\n' + text.replace(/\r\n/g, '\n').replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
    return new Blob([vtt], { type: 'text/vtt' });
  };

  const uploadSubtitleFile = async (entry: SubtitleEntry, userId: string) => {
    const baseName = entry.file.name.replace(/\.(srt|vtt)$/i, '');
    const blobName = `${userId}/${Date.now()}-${baseName}.vtt`;
    const sasRes   = await fetch('/api/upload/sas', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ container: 'subtitles', blobName, contentType: 'text/vtt' }),
    });
    if (!sasRes.ok) throw new Error('Failed to get subtitle upload URL');
    const { uploadUrl, readUrl } = await sasRes.json();
    const body = entry.file.name.toLowerCase().endsWith('.srt') ? await srtToVtt(entry.file) : entry.file;
    await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': 'text/vtt', 'Content-Length': String(body instanceof Blob ? body.size : (body as File).size) },
      body,
    });
    return { label: entry.label, lang: entry.lang, url: readUrl };
  };

  const updateSubtitleLang = (id: string, lang: string, setter = setSubtitleEntries) => {
    const opt = LANGUAGE_OPTIONS.find((l) => l.code === lang);
    setter((prev) => prev.map((s) => s.id === id ? { ...s, lang, label: opt?.label || lang } : s));
  };

  // ─────────────────────────────────────────────────────────
  // Torrent submit — new flow
  // ─────────────────────────────────────────────────────────
  const handleTorrentSubmit = async () => {
    if (!hashInput.trim() || !torrentTitle.trim()) return;
    setSubmitPhase('idle');
    setTorrentError('');

    if (!canTorrent) {
      setTorrentError('You don\'t have permission to upload via torrent. Ask an admin to enable this for your account.');
      return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // ── 0. Check torrent size BEFORE doing anything else ────
      setSubmitPhase('checking-size');

      // Extract info hash from magnet URI or raw hash
      let checkHash = hashInput.trim();
      const magnetHashMatch = checkHash.match(/btih:([a-fA-F0-9]{40})/i);
      if (magnetHashMatch) checkHash = magnetHashMatch[1];
      checkHash = checkHash.toUpperCase();

      // Only check if we have a valid-looking hash (40 hex chars)
      if (/^[A-F0-9]{40}$/.test(checkHash)) {
        try {
          const sizeCheckRes = await fetch(
            `https://apibay.org/q.php?q=${checkHash}`,
            { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Mozilla/5.0' } },
          );
          if (sizeCheckRes.ok) {
            const sizeCheckText = await sizeCheckRes.text();
            if (sizeCheckText.startsWith('[')) {
              const sizeCheckData = JSON.parse(sizeCheckText);
              if (Array.isArray(sizeCheckData) && sizeCheckData.length > 0 && !(sizeCheckData.length === 1 && sizeCheckData[0].id === '0')) {
                const exactMatch = sizeCheckData.find((t: any) => (t.info_hash || '').toUpperCase() === checkHash);
                const sizeEntry = exactMatch || sizeCheckData[0];
                const torrentSizeBytes = parseInt(sizeEntry?.size) || 0;

                if (torrentSizeBytes > 0 && torrentSizeBytes > MAX_MOVIE_SIZE_BYTES) {
                  const sizeGB = (torrentSizeBytes / 1024 / 1024 / 1024).toFixed(2);
                  const maxGB = (MAX_MOVIE_SIZE_BYTES / 1024 / 1024 / 1024).toFixed(0);
                  setTorrentError(
                    `This torrent is ${sizeGB} GB which exceeds the ${maxGB} GB limit. Please choose a smaller source.`
                  );
                  setSubmitPhase('idle');
                  return;
                }
              }
            }
          }
        } catch {
          // Size check failed (network, timeout, etc.) — allow the server-side check to handle it
          // Don't block the submission just because the size check API is unreachable
        }
      }

      // ── 1. Upload poster ────────────────────────────────────
      let posterUrl: string | undefined;
      if (torrentPosterFile) {
        setSubmitPhase('uploading-poster');
        const posterName   = generateBlobName(user.id, torrentPosterFile.name);
        const posterSasRes = await fetch('/api/upload/sas', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ container: 'posters', blobName: posterName, contentType: torrentPosterFile.type }),
        });
        if (!posterSasRes.ok) throw new Error('Failed to get poster upload URL');
        const { uploadUrl: pUrl, readUrl: pReadUrl } = await posterSasRes.json();
        await fetch(pUrl, {
          method: 'PUT',
          headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': torrentPosterFile.type, 'Content-Length': String(torrentPosterFile.size) },
          body: torrentPosterFile,
        });
        posterUrl = pReadUrl;
      } else if (torrentPosterPreview && torrentPosterPreview.startsWith('https://image.tmdb.org')) {
        // TMDB poster URL from search flow — use directly
        posterUrl = torrentPosterPreview;
      }

      // ── 2. Upload subtitles ─────────────────────────────────
      let uploadedSubtitles: { label: string; lang: string; url: string }[] = [];
      if (torrentSubtitles.length > 0) {
        setSubmitPhase('uploading-subs');
        uploadedSubtitles = await Promise.all(
          torrentSubtitles.map((s) => uploadSubtitleFile(s, user.id)),
        );
      }

      // ── 3. Build slug + blob base name ──────────────────────
      const slug         = torrentTitle.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const blobBaseName = `${user.id}/${Date.now()}-${slug}`;

      // ── 4. Submit to /api/ingest/submit (Stage 4 route) ────
      //    This route handles ensure-container internally and
      //    emits phase info we can simulate on the client side.
      //    We show service-check → service-starting → submitting
      //    based on timing since we can't stream the phase from
      //    a non-SSE POST response.
      setSubmitPhase('service-check');

      // After 2s with no response, assume container is starting
      const phaseTimer = setTimeout(() => setSubmitPhase('service-starting'), 2_000);
      const connectTimer = setTimeout(() => setSubmitPhase('service-connecting'), 15_000);

      let jobId: string;
      try {
        const res = await fetch('/api/ingest/submit', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            hash:           hashInput.trim(),
            movie_name:     torrentTitle.trim(),
            blob_base_name: blobBaseName,
            metadata: {
              description: torrentDesc.trim() || undefined,
              quality:     torrentQuality ?? undefined,
              posterUrl,
              subtitles:   uploadedSubtitles.length > 0 ? uploadedSubtitles : undefined,
              // TMDB / manual metadata
              tmdb_id:           selectedTmdb?.tmdb_id ?? undefined,
              release_date:      torrentReleaseDate.trim() || undefined,
              rating:            torrentRating.trim() ? parseFloat(torrentRating) : undefined,
              genres:            torrentGenres.trim() ? torrentGenres.split(',').map((g) => g.trim()).filter(Boolean) : undefined,
              runtime:           torrentRuntime.trim() ? parseInt(torrentRuntime, 10) : undefined,
              tagline:           torrentTagline.trim() || undefined,
              imdb_id:           torrentImdbId.trim() || undefined,
              original_language: torrentLanguage.trim() || undefined,
              source_type:       torrentSourceType.trim() || undefined,
              // Subtitle language preference for auto-download
              subtitle_languages: subtitleSecondLang ? ['en', subtitleSecondLang] : ['en'],
            },
          }),
        });

        clearTimeout(phaseTimer);
        clearTimeout(connectTimer);

        if (!res.ok) {
          const body = await res.json();
          throw new Error(body.error ?? 'Failed to start ingest');
        }

        const data = await res.json();
        jobId = data.job_id;
      } catch (err) {
        clearTimeout(phaseTimer);
        clearTimeout(connectTimer);
        throw err;
      }

      setSubmitPhase('submitting');

      // ── 5. Add to active jobs + attach SSE ─────────────────
      const streamMeta = {
        description: torrentDesc.trim() || undefined,
        quality:     torrentQuality ?? undefined,
        posterUrl,
        subtitles:   uploadedSubtitles.length > 0 ? uploadedSubtitles : undefined,
      };

      const newJob: ActiveJob = {
        jobId,
        title:     torrentTitle.trim(),
        hash:      hashInput.trim(),
        job:       null,
        streamMeta,
        startedAt: Date.now(),
      };

      setActiveJobs((prev) => [newJob, ...prev]);
      _attachStream(jobId, torrentTitle.trim(), streamMeta);

      // ── 6. Reset form ───────────────────────────────────────
      setHashInput('');
      setTorrentTitle('');
      setTorrentDesc('');
      setTorrentQuality(null);
      setTorrentSubtitles([]);
      setTorrentPosterFile(null);
      setTorrentPosterPreview(null);
      setTorrentReleaseDate('');
      setTorrentRating('');
      setTorrentGenres('');
      setTorrentRuntime('');
      setTorrentSourceType('');
      setTorrentImdbId('');
      setTorrentTagline('');
      setTorrentLanguage('');
      setSelectedTmdb(null);
      setTmdbQuality(null);
      setSubmitPhase('done');
      setTab('jobs');

    } catch (err: any) {
      setTorrentError(err.message ?? 'Something went wrong');
      setSubmitPhase('idle');
    }
  };

  const isSubmitting = submitPhase !== 'idle' && submitPhase !== 'done';

  // ─────────────────────────────────────────────────────────
  // Cancel job
  // ─────────────────────────────────────────────────────────
  const handleCancel = async (jobId: string) => {
    try {
      // Stage 4 cancel proxy route
      await fetch(`/api/ingest/cancel/${jobId}`, { method: 'DELETE' });
      esRefs.current[jobId]?.close();
      delete esRefs.current[jobId];
      setActiveJobs((prev) =>
        prev.map((aj) =>
          aj.jobId === jobId
            ? { ...aj, job: { ...(aj.job as TorrentJob), stage: 'Cancelled' } }
            : aj,
        ),
      );
    } catch {}
  };

  // ─────────────────────────────────────────────────────────
  // TMDB search helpers
  // ─────────────────────────────────────────────────────────
  const handleTmdbSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setTmdbResults([]); return; }
    setTmdbSearching(true);
    setTmdbError('');
    try {
      const res = await fetch(`/api/tmdb/search?query=${encodeURIComponent(q.trim())}`);
      if (!res.ok) throw new Error('Search failed');
      const data = await res.json();
      setTmdbResults(data.results || []);
    } catch (err: any) {
      setTmdbError(err.message || 'Search failed');
    } finally {
      setTmdbSearching(false);
    }
  }, []);

  const handleTmdbQueryChange = (value: string) => {
    setTmdbQuery(value);
    // Clear selected movie and torrent results when user starts typing again
    if (selectedTmdb) setSelectedTmdb(null);
    if (torrentSearchResults.length > 0) setTorrentSearchResults([]);
    if (tmdbSearchTimer.current) clearTimeout(tmdbSearchTimer.current);
    if (!value.trim()) { setTmdbResults([]); return; }
    tmdbSearchTimer.current = setTimeout(() => handleTmdbSearch(value), 400);
  };

  const handleTmdbSelect = async (tmdbId: number) => {
    setTmdbLoadingDetail(true);
    setTmdbError('');
    // Clear previous movie's torrent results and quality
    setAllTorrentResults([]);
    setTorrentSearchResults([]);
    setTorrentSearchError('');
    setTmdbQuality(null);
    try {
      const res = await fetch(`/api/tmdb/search?id=${tmdbId}`);
      if (!res.ok) throw new Error('Failed to load movie details');
      const data = await res.json();
      setSelectedTmdb(data.movie);
      setTmdbResults([]);
      setTmdbQuery('');
    } catch (err: any) {
      setTmdbError(err.message || 'Failed to load details');
    } finally {
      setTmdbLoadingDetail(false);
    }
  };

  const handleTmdbConfirmToTorrent = () => {
    if (!selectedTmdb) return;
    // Pre-fill the torrent tab with TMDB metadata
    setTorrentTitle(selectedTmdb.title);
    setTorrentDesc(selectedTmdb.overview || '');
    if (selectedTmdb.poster_url) {
      setTorrentPosterPreview(selectedTmdb.poster_url);
    }
    setTorrentQuality(tmdbQuality);
    setTorrentReleaseDate(selectedTmdb.release_date || '');
    setTorrentRating(selectedTmdb.rating ? String(selectedTmdb.rating) : '');
    setTorrentGenres(selectedTmdb.genres?.join(', ') || '');
    setTorrentRuntime(selectedTmdb.runtime ? String(selectedTmdb.runtime) : '');
    setTorrentTagline(selectedTmdb.tagline || '');
    setTorrentImdbId(selectedTmdb.imdb_id || '');
    setTorrentLanguage(selectedTmdb.language || '');
    setTorrentSearchResults([]);
    setTab('torrent');
  };

  const handleSearchTorrentSources = async () => {
    if (!selectedTmdb) return;
    setTorrentSearching(true);
    setTorrentSearchError('');
    setTorrentSearchResults([]);
    setAllTorrentResults([]);
    try {
      const year = selectedTmdb.year;
      const params = new URLSearchParams({ query: selectedTmdb.title });
      if (year) params.set('year', String(year));
      // Don't send quality to API — we fetch ALL results and filter client-side
      // so switching quality is instant

      const res = await fetch(`/api/torrent/search?${params}`);
      if (!res.ok) throw new Error('Search failed');
      const data = await res.json();
      const all = data.results || [];
      setAllTorrentResults(all);
      // Apply quality filter if one is selected
      if (tmdbQuality) {
        const filtered = all.filter((r: TorrentSearchResult) => r.quality === tmdbQuality);
        const others = all.filter((r: TorrentSearchResult) => r.quality !== tmdbQuality);
        setTorrentSearchResults([...filtered, ...others]);
      } else {
        setTorrentSearchResults(all);
      }
      if (!all.length) {
        setTorrentSearchError('No sources found. Try "I have a torrent" to paste a hash manually.');
      }
    } catch (err: any) {
      setTorrentSearchError(err.message || 'Failed to search');
    } finally {
      setTorrentSearching(false);
    }
  };

  // Re-filter torrent results when quality changes (instant, no API call)
  const handleQualityChange = (q: VideoQuality) => {
    const newQuality = tmdbQuality === q ? null : q;
    setTmdbQuality(newQuality);
    if (allTorrentResults.length > 0) {
      if (newQuality) {
        const filtered = allTorrentResults.filter(r => r.quality === newQuality);
        const others = allTorrentResults.filter(r => r.quality !== newQuality);
        setTorrentSearchResults([...filtered, ...others]);
      } else {
        setTorrentSearchResults(allTorrentResults);
      }
    }
  };

  const MAX_MOVIE_SIZE_BYTES = (parseFloat(process.env.NEXT_PUBLIC_MAX_MOVIE_SIZE_GB || '7')) * 1024 * 1024 * 1024;

  const handlePickTorrentResult = (result: TorrentSearchResult) => {
    if (!selectedTmdb) return;

    // Check file size limit
    if (result.size_bytes > 0 && result.size_bytes > MAX_MOVIE_SIZE_BYTES) {
      const maxGB = (MAX_MOVIE_SIZE_BYTES / 1024 / 1024 / 1024).toFixed(0);
      alert(`This torrent is ${result.size} which exceeds the ${maxGB} GB limit. Please choose a smaller source.`);
      return;
    }

    // Pre-fill torrent tab with TMDB metadata + selected torrent hash
    setTorrentTitle(selectedTmdb.title);
    setTorrentDesc(selectedTmdb.overview || '');
    if (selectedTmdb.poster_url) {
      setTorrentPosterPreview(selectedTmdb.poster_url);
    }
    setTorrentQuality(tmdbQuality || (result.quality as VideoQuality) || null);
    setTorrentReleaseDate(selectedTmdb.release_date || '');
    setTorrentRating(selectedTmdb.rating ? String(selectedTmdb.rating) : '');
    setTorrentGenres(selectedTmdb.genres?.join(', ') || '');
    setTorrentRuntime(selectedTmdb.runtime ? String(selectedTmdb.runtime) : '');
    setTorrentTagline(selectedTmdb.tagline || '');
    setTorrentImdbId(selectedTmdb.imdb_id || '');
    setTorrentLanguage(selectedTmdb.language || '');
    setTorrentSourceType(result.source_type || '');
    setHashInput(result.magnet || result.hash);
    setTorrentSearchResults([]);
    setAllTorrentResults([]);
    setTab('torrent');
  };

  // ─────────────────────────────────────────────────────────
  // Direct upload helpers (unchanged)
  // ─────────────────────────────────────────────────────────
  const detectDuration = useCallback((file: File) => {
    const url   = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const secs = Math.round(video.duration);
      if (isFinite(secs) && secs > 0) { setDetectedDuration(secs); setDuration(secs); }
      URL.revokeObjectURL(url);
    };
    video.onerror = () => URL.revokeObjectURL(url);
    video.src = url;
  }, []);

  const handleMovieDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragActive(false);
    const file = e.dataTransfer.files[0];
    if (file?.type.startsWith('video/')) {
      setMovieFile(file);
      if (!title) setTitle(file.name.replace(/\.[^/.]+$/, '').replace(/[_.-]/g, ' ').trim());
      detectDuration(file);
    }
  }, [title, detectDuration]);

  const handleMovieSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setMovieFile(file);
      if (!title) setTitle(file.name.replace(/\.[^/.]+$/, '').replace(/[_.-]/g, ' ').trim());
      detectDuration(file);
    }
  };

  const handlePosterSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_POSTER_SIZE) { setDirectError('Poster image must be under 10MB'); return; }
    setPosterFile(file);
    setPosterPreview(URL.createObjectURL(file));
  };

  const handleTorrentPosterSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_POSTER_SIZE) { setTorrentError('Poster image must be under 10MB'); return; }
    setTorrentPosterFile(file);
    setTorrentPosterPreview(URL.createObjectURL(file));
  };

  const handleSubtitleAdd = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const newEntries: SubtitleEntry[] = files.map((file) => {
      const parts    = file.name.replace(/\.(srt|vtt)$/i, '').split('.');
      const lastPart = parts[parts.length - 1].toLowerCase();
      const detected = LANGUAGE_OPTIONS.find((l) => l.code === lastPart);
      return { id: Math.random().toString(36).slice(2), file, lang: detected?.code || 'en', label: detected?.label || 'English' };
    });
    setSubtitleEntries((prev) => [...prev, ...newEntries]);
    e.target.value = '';
  };

  const handleDirectUpload = async () => {
    if (!movieFile || !title.trim()) return;
    setUploading(true); setDirectError(''); setUploadProgress(0);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      setUploadStage('Preparing upload...');
      const blobName = generateBlobName(user.id, movieFile.name);
      const sasRes   = await fetch('/api/upload/sas', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ container: 'movies', blobName, contentType: getVideoMimeType(movieFile.name) }),
      });
      if (!sasRes.ok) throw new Error('Failed to get upload URL');
      const { uploadUrl } = await sasRes.json();

      setUploadStage('Uploading movie...');
      const xhr = new XMLHttpRequest();
      await new Promise<void>((resolve, reject) => {
        xhr.upload.addEventListener('progress', (e) => { if (e.lengthComputable) setUploadProgress(Math.round(e.loaded / e.total * 80)); });
        xhr.addEventListener('load',  () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed: ${xhr.status}`)));
        xhr.addEventListener('error', () => reject(new Error('Upload failed')));
        xhr.open('PUT', uploadUrl);
        xhr.setRequestHeader('x-ms-blob-type', 'BlockBlob');
        xhr.setRequestHeader('Content-Type', getVideoMimeType(movieFile.name));
        xhr.send(movieFile);
      });

      setUploadProgress(82);
      let posterBlobName = null;
      if (posterFile) {
        setUploadStage('Uploading poster...');
        const posterName   = generateBlobName(user.id, posterFile.name);
        const posterSasRes = await fetch('/api/upload/sas', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ container: 'posters', blobName: posterName, contentType: posterFile.type }),
        });
        if (posterSasRes.ok) {
          const { uploadUrl: pUrl } = await posterSasRes.json();
          await fetch(pUrl, { method: 'PUT', headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': posterFile.type, 'Content-Length': String(posterFile.size) }, body: posterFile });
          posterBlobName = posterName;
        }
      }

      setUploadProgress(87);
      let subtitleData: { label: string; lang: string; url: string }[] = [];
      if (subtitleEntries.length > 0) {
        setUploadStage('Uploading subtitles...');
        subtitleData = await Promise.all(subtitleEntries.map((s) => uploadSubtitleFile(s, user.id)));
      }

      setUploadProgress(93);
      setUploadStage('Saving movie info...');
      const movieData = {
        title: title.trim(), description: description.trim() || null,
        blob_name: blobName,
        blob_url:  `https://${process.env.NEXT_PUBLIC_AZURE_STORAGE_ACCOUNT_NAME}.blob.core.windows.net/movies/${blobName}`,
        poster_url: posterBlobName ? `https://${process.env.NEXT_PUBLIC_AZURE_STORAGE_ACCOUNT_NAME}.blob.core.windows.net/posters/${posterBlobName}` : null,
        file_size: movieFile.size, format: movieFile.name.split('.').pop()?.toLowerCase() || 'mp4',
        quality: quality || null, duration: duration || null,
        uploaded_by: user.id,
        subtitles: subtitleData,
        ingest_method: 'direct_upload',
      };
      const saveRes = await fetch('/api/movies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(movieData) });
      if (!saveRes.ok) throw new Error('Failed to save movie metadata');
      const { movie } = await saveRes.json();
      setUploadProgress(100); setUploadStage('Done!');
      setTimeout(() => router.push(`/movie/${movie.id}`), 1000);
    } catch (err: any) {
      setDirectError(err.message || 'Upload failed. Please try again.');
      setUploading(false);
    }
  };

  // ─────────────────────────────────────────────────────────
  // Derived
  // ─────────────────────────────────────────────────────────
  const activeCount = activeJobs.filter((j) => j.job && !TERMINAL.has(j.job.stage)).length;

  // ─────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="relative z-10 pt-24 pb-16 px-4 sm:px-6 lg:px-8 max-w-2xl mx-auto">

        {/* Page header */}
        <div className="mb-8">
          <h1 className="font-display text-3xl font-bold text-cinema-text mb-2">
            Add a Movie <span className="text-cinema-accent">🎞️</span>
          </h1>
          <p className="text-cinema-text-muted">Search a movie, upload a file, or fetch by torrent hash</p>
        </div>

        {/* Tab switcher */}
        <div className="flex items-center gap-1 p-1 rounded-2xl bg-cinema-card/60 border border-cinema-border backdrop-blur-sm mb-6">
          {([
            { id: 'search',  icon: <Search className="w-4 h-4" />,     label: 'Search Movie'   },
            { id: 'direct',  icon: <Upload className="w-4 h-4" />,     label: 'Upload File'    },
            { id: 'torrent', icon: <Magnet className="w-4 h-4" />,     label: 'Torrent / Hash' },
            { id: 'jobs',    icon: <FolderOpen className="w-4 h-4" />, label: 'Active Jobs', badge: activeCount },
          ] as { id: Tab; icon: React.ReactNode; label: string; badge?: number }[]).map(({ id, icon, label, badge }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-sm font-medium transition-all duration-200',
                tab === id
                  ? 'bg-cinema-accent text-cinema-bg shadow-sm'
                  : 'text-cinema-text-muted hover:text-cinema-text hover:bg-cinema-surface/60',
              )}
            >
              {icon}
              <span className="hidden sm:inline">{label}</span>
              {badge != null && badge > 0 && (
                <span className={cn(
                  'inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold',
                  tab === id ? 'bg-cinema-bg/30 text-cinema-bg' : 'bg-cinema-secondary/20 text-cinema-secondary',
                )}>
                  {badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── TAB: Search Movie (TMDB) ────────────────────────── */}
        {tab === 'search' && (
          <div className="space-y-6 animate-fade-in">

            {/* Search bar */}
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-cinema-text-dim" />
              <input
                type="text"
                placeholder="Search for a movie..."
                value={tmdbQuery}
                onChange={(e) => handleTmdbQueryChange(e.target.value)}
                autoFocus
                className="w-full pl-12 pr-4 py-4 rounded-2xl bg-cinema-card/50 border border-cinema-border text-cinema-text placeholder:text-cinema-text-dim focus:outline-none focus:border-cinema-accent/50 focus:ring-2 focus:ring-cinema-accent/20 transition-all text-lg"
              />
              {tmdbSearching && (
                <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-cinema-accent animate-spin" />
              )}
            </div>

            {tmdbError && (
              <div className="flex items-center gap-3 p-4 rounded-xl bg-cinema-error/10 border border-cinema-error/20">
                <AlertCircle className="w-5 h-5 text-cinema-error flex-shrink-0" />
                <p className="text-sm text-cinema-error">{tmdbError}</p>
              </div>
            )}

            {/* Selected movie detail card */}
            {selectedTmdb && (
              <div className="bg-cinema-card/50 backdrop-blur-sm border border-cinema-accent/30 rounded-2xl overflow-hidden animate-fade-in">
                <div className="flex gap-5 p-5">
                  {/* Poster */}
                  {selectedTmdb.poster_url ? (
                    <img
                      src={selectedTmdb.poster_url}
                      alt={selectedTmdb.title}
                      className="w-32 h-48 rounded-xl object-cover flex-shrink-0 shadow-lg"
                    />
                  ) : (
                    <div className="w-32 h-48 rounded-xl bg-cinema-surface flex items-center justify-center flex-shrink-0">
                      <Film className="w-10 h-10 text-cinema-text-dim" />
                    </div>
                  )}

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-display text-xl font-bold text-cinema-text leading-tight">
                        {selectedTmdb.title}
                      </h3>
                      <button
                        onClick={() => setSelectedTmdb(null)}
                        className="text-cinema-text-dim hover:text-cinema-error transition-colors flex-shrink-0"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    {selectedTmdb.tagline && (
                      <p className="text-sm text-cinema-accent italic mt-1">{selectedTmdb.tagline}</p>
                    )}

                    {/* Metadata chips */}
                    <div className="flex flex-wrap items-center gap-2 mt-3">
                      {selectedTmdb.year && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-cinema-surface text-xs text-cinema-text-muted">
                          <Calendar className="w-3 h-3" /> {selectedTmdb.year}
                        </span>
                      )}
                      {selectedTmdb.runtime && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-cinema-surface text-xs text-cinema-text-muted">
                          <Clock className="w-3 h-3" /> {Math.floor(selectedTmdb.runtime / 60)}h {selectedTmdb.runtime % 60}m
                        </span>
                      )}
                      {selectedTmdb.rating > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-yellow-500/10 text-xs text-yellow-400 font-medium">
                          <Star className="w-3 h-3" fill="currentColor" /> {selectedTmdb.rating.toFixed(1)}
                        </span>
                      )}
                      {selectedTmdb.language && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-cinema-surface text-xs text-cinema-text-muted uppercase">
                          {selectedTmdb.language}
                        </span>
                      )}
                    </div>

                    {/* Genres */}
                    {selectedTmdb.genres?.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {selectedTmdb.genres.map((g) => (
                          <span key={g} className="px-2 py-0.5 rounded-md bg-cinema-accent/10 text-[11px] text-cinema-accent font-medium">
                            {g}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Overview */}
                    {selectedTmdb.overview && (
                      <p className="text-sm text-cinema-text-muted mt-3 line-clamp-3 leading-relaxed">
                        {selectedTmdb.overview}
                      </p>
                    )}
                  </div>
                </div>

                {/* Quality selector + action buttons */}
                <div className="border-t border-cinema-border px-5 py-4 space-y-4">
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm font-medium text-cinema-text-muted">
                      <Gauge className="w-4 h-4 text-cinema-accent" /> Preferred Quality
                    </label>
                    <div className="grid grid-cols-4 gap-2">
                      {QUALITY_OPTIONS.map((opt) => (
                        <button key={opt.value} type="button" onClick={() => handleQualityChange(opt.value)}
                          className={cn('flex flex-col items-center py-2.5 px-3 rounded-xl border text-xs font-medium transition-all duration-200',
                            tmdbQuality === opt.value ? 'border-cinema-accent bg-cinema-accent/10 text-cinema-accent' : 'border-cinema-border bg-cinema-card/50 text-cinema-text-muted hover:border-cinema-accent/40 hover:text-cinema-text')}>
                          <span className="text-sm font-bold">{opt.label}</span>
                          <span className="text-[10px] mt-0.5 opacity-70">{opt.desc}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Two paths */}
                  <div className="grid grid-cols-2 gap-3">
                    <Button
                      onClick={handleSearchTorrentSources}
                      size="lg"
                      className="w-full"
                      icon={torrentSearching ? undefined : <Search className="w-4 h-4" />}
                      loading={torrentSearching}
                    >
                      {torrentSearching ? 'Searching...' : 'Search for sources'}
                    </Button>
                    <Button
                      onClick={handleTmdbConfirmToTorrent}
                      size="lg"
                      variant="secondary"
                      className="w-full"
                      icon={<Hash className="w-4 h-4" />}
                    >
                      I have a torrent
                    </Button>
                  </div>

                  <p className="text-xs text-cinema-text-dim text-center">
                    Search finds torrents automatically, or paste your own hash on the Torrent tab
                  </p>
                </div>

                {/* Torrent search error */}
                {torrentSearchError && !torrentSearching && torrentSearchResults.length === 0 && (
                  <div className="mx-5 mb-4 flex items-center gap-3 p-3 rounded-xl bg-cinema-warm/10 border border-cinema-warm/20">
                    <AlertTriangle className="w-4 h-4 text-cinema-warm flex-shrink-0" />
                    <p className="text-sm text-cinema-warm">{torrentSearchError}</p>
                  </div>
                )}

                {/* Torrent search results */}
                {torrentSearchResults.length > 0 && (
                  <div className="border-t border-cinema-border">
                    <div className="px-5 py-3 flex items-center justify-between">
                      <p className="text-sm font-medium text-cinema-text-muted">
                        {torrentSearchResults.length} source{torrentSearchResults.length !== 1 ? 's' : ''} found
                      </p>
                      <button
                        onClick={() => setTorrentSearchResults([])}
                        className="text-xs text-cinema-text-dim hover:text-cinema-text-muted transition-colors"
                      >
                        Clear
                      </button>
                    </div>
                    <div className="px-5 pb-4 space-y-2 max-h-[400px] overflow-y-auto">
                      {torrentSearchResults.map((r, i) => {
                        const isOversized = r.size_bytes > 0 && r.size_bytes > MAX_MOVIE_SIZE_BYTES;
                        return (
                        <div
                          key={`${r.hash}-${i}`}
                          className={cn(
                            'flex items-start gap-3 p-3 rounded-xl border transition-all group/result',
                            isOversized
                              ? 'bg-cinema-surface/50 border-cinema-border/50 opacity-60'
                              : 'bg-cinema-surface border-cinema-border hover:border-cinema-accent/30',
                          )}
                        >
                          <div className="flex-1 min-w-0">
                            {/* Torrent name */}
                            <p className={cn('text-sm font-medium truncate leading-snug', isOversized ? 'text-cinema-text-dim' : 'text-cinema-text')}>{r.name}</p>

                            {/* Badges row */}
                            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                              {/* Seeders */}
                              <span className={cn(
                                'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium',
                                r.seeders >= 20 ? 'bg-cinema-success/10 text-cinema-success' :
                                r.seeders >= 5  ? 'bg-cinema-warm/10 text-cinema-warm' :
                                                   'bg-cinema-error/10 text-cinema-error',
                              )}>
                                <Users className="w-3 h-3" />
                                {r.seeders}
                              </span>

                              {/* Size — red if oversized */}
                              <span className={cn(
                                'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px]',
                                isOversized ? 'bg-cinema-error/10 text-cinema-error font-medium' : 'bg-cinema-card text-cinema-text-dim',
                              )}>
                                <HardDrive className="w-3 h-3" />
                                {r.size}
                                {isOversized && <span className="ml-0.5">· Too large</span>}
                              </span>

                              {/* Quality */}
                              {r.quality && (
                                <span className="px-2 py-0.5 rounded-md bg-cinema-accent/10 text-[11px] text-cinema-accent font-medium">
                                  {r.quality}
                                </span>
                              )}

                              {/* Source type */}
                              {r.source_type && (
                                <span className="px-2 py-0.5 rounded-md bg-cinema-secondary/10 text-[11px] text-cinema-secondary font-medium">
                                  {r.source_type}
                                </span>
                              )}

                              {/* Codec */}
                              {r.codec && (
                                <span className="px-2 py-0.5 rounded-md bg-cinema-card text-[11px] text-cinema-text-dim">
                                  {r.codec}
                                </span>
                              )}

                              {/* Origin */}
                              <span className="px-2 py-0.5 rounded-md bg-cinema-card text-[11px] text-cinema-text-dim">
                                {r.origin}
                              </span>
                            </div>
                          </div>

                          {/* Select button — disabled if oversized */}
                          {isOversized ? (
                            <span className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-cinema-error/5 text-cinema-error/50 border border-cinema-error/10 mt-0.5 cursor-not-allowed">
                              Exceeds limit
                            </span>
                          ) : (
                            <button
                              onClick={() => handlePickTorrentResult(r)}
                              className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-cinema-accent/10 text-cinema-accent border border-cinema-accent/20 hover:bg-cinema-accent/20 transition-all mt-0.5"
                            >
                              <Download className="w-3.5 h-3.5" />
                              Select
                            </button>
                          )}
                        </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Loading detail */}
            {tmdbLoadingDetail && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 text-cinema-accent animate-spin" />
              </div>
            )}

            {/* Search results grid */}
            {!selectedTmdb && tmdbResults.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {tmdbResults.map((m) => (
                  <button
                    key={m.tmdb_id}
                    onClick={() => handleTmdbSelect(m.tmdb_id)}
                    className="group text-left rounded-xl overflow-hidden bg-cinema-card/50 border border-cinema-border hover:border-cinema-accent/50 transition-all duration-300 hover:shadow-[0_4px_20px_rgba(232,160,191,0.15)] hover:-translate-y-1"
                  >
                    {/* Poster */}
                    <div className="relative aspect-[2/3] bg-cinema-surface">
                      {m.poster_url ? (
                        <img src={m.poster_url} alt={m.title} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Film className="w-10 h-10 text-cinema-text-dim opacity-30" />
                        </div>
                      )}
                      {/* Rating badge */}
                      {m.rating > 0 && (
                        <div className="absolute top-2 right-2 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-black/70 backdrop-blur-sm">
                          <Star className="w-3 h-3 text-yellow-400" fill="currentColor" />
                          <span className="text-[11px] font-bold text-white">{m.rating.toFixed(1)}</span>
                        </div>
                      )}
                      {/* Gradient */}
                      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/80 to-transparent" />
                    </div>
                    {/* Info */}
                    <div className="p-3">
                      <h4 className="text-sm font-semibold text-cinema-text line-clamp-1">{m.title}</h4>
                      <div className="flex items-center gap-1.5 mt-1 text-[11px] text-cinema-text-dim">
                        {m.year && <span>{m.year}</span>}
                        {m.year && m.genres.length > 0 && <span className="text-cinema-text-dim/40">·</span>}
                        {m.genres.length > 0 && <span className="truncate">{m.genres.slice(0, 2).join(', ')}</span>}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Empty state */}
            {!selectedTmdb && !tmdbSearching && tmdbResults.length === 0 && tmdbQuery.trim().length === 0 && (
              <div className="text-center py-16">
                <div className="w-16 h-16 rounded-2xl bg-cinema-card border border-cinema-border flex items-center justify-center mx-auto mb-4">
                  <Search className="w-8 h-8 text-cinema-text-dim opacity-40" />
                </div>
                <p className="text-cinema-text-muted font-medium">Search for any movie</p>
                <p className="text-sm text-cinema-text-dim mt-1">We&apos;ll fetch details from TMDB — title, poster, rating, genres, runtime</p>
              </div>
            )}

            {/* No results */}
            {!selectedTmdb && !tmdbSearching && tmdbResults.length === 0 && tmdbQuery.trim().length > 0 && (
              <div className="text-center py-12">
                <p className="text-cinema-text-muted">No movies found for &ldquo;{tmdbQuery}&rdquo;</p>
                <p className="text-sm text-cinema-text-dim mt-1">Try a different title or spelling</p>
              </div>
            )}
          </div>
        )}

        {/* ── TAB: Direct Upload ─────────────────────────────── */}
        {tab === 'direct' && (
          <div className="space-y-6 animate-fade-in">
            {/* Drop zone */}
            <div
              className={cn(
                'relative rounded-2xl border-2 border-dashed p-8 text-center transition-all duration-300 cursor-pointer',
                dragActive ? 'border-cinema-accent bg-cinema-accent/5'
                  : movieFile ? 'border-cinema-success/50 bg-cinema-success/5'
                  : 'border-cinema-border hover:border-cinema-accent/50 bg-cinema-card/30',
              )}
              onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleMovieDrop}
              onClick={() => document.getElementById('movieInput')?.click()}
            >
              <input id="movieInput" type="file" accept={ACCEPTED_VIDEO} onChange={handleMovieSelect} className="hidden" />
              {movieFile ? (
                <div className="flex items-center justify-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-cinema-success/10 flex items-center justify-center">
                    <CheckCircle className="w-6 h-6 text-cinema-success" />
                  </div>
                  <div className="text-left">
                    <p className="font-medium text-cinema-text">{movieFile.name}</p>
                    <div className="flex items-center gap-3 mt-0.5">
                      <p className="text-sm text-cinema-text-muted">{formatFileSize(movieFile.size)}</p>
                      {detectedDuration && (
                        <p className="text-sm text-cinema-accent flex items-center gap-1">
                          <Clock className="w-3 h-3" />{formatDuration(detectedDuration)} detected
                        </p>
                      )}
                    </div>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); setMovieFile(null); setDuration(null); setDetectedDuration(null); }} className="ml-4 text-cinema-text-dim hover:text-cinema-error transition-colors">
                    <X className="w-5 h-5" />
                  </button>
                </div>
              ) : (
                <>
                  <div className="w-16 h-16 rounded-2xl bg-cinema-accent/10 flex items-center justify-center mx-auto mb-4">
                    <Upload className="w-8 h-8 text-cinema-accent" />
                  </div>
                  <p className="font-medium text-cinema-text mb-1">Drop your movie file here</p>
                  <p className="text-sm text-cinema-text-muted">or click to browse</p>
                  <p className="text-xs text-cinema-text-dim mt-2">MP4, MKV, AVI, MOV, WebM</p>
                </>
              )}
            </div>

            {/* Movie details */}
            <div className="bg-cinema-card/50 backdrop-blur-sm border border-cinema-border rounded-2xl p-6 space-y-5">
              <Input id="title" label="Movie Title" placeholder="e.g. Our Favorite Movie" icon={<Film className="w-4 h-4" />} value={title} onChange={(e) => setTitle(e.target.value)} required />
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-cinema-text-muted">Description (optional)</label>
                <textarea placeholder="What's this movie about?" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="w-full rounded-xl bg-cinema-card border border-cinema-border px-4 py-3 text-cinema-text placeholder:text-cinema-text-dim focus:outline-none focus:border-cinema-accent/50 focus:ring-2 focus:ring-cinema-accent/20 transition-all resize-none" />
              </div>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium text-cinema-text-muted">
                  <Gauge className="w-4 h-4 text-cinema-accent" /> Video Quality <span className="text-xs font-normal text-cinema-text-dim">(optional)</span>
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {QUALITY_OPTIONS.map((opt) => (
                    <button key={opt.value} type="button" onClick={() => setQuality(quality === opt.value ? null : opt.value)}
                      className={cn('flex flex-col items-center py-2.5 px-3 rounded-xl border text-xs font-medium transition-all duration-200',
                        quality === opt.value ? 'border-cinema-accent bg-cinema-accent/10 text-cinema-accent' : 'border-cinema-border bg-cinema-card/50 text-cinema-text-muted hover:border-cinema-accent/40 hover:text-cinema-text')}>
                      <span className="text-sm font-bold">{opt.label}</span>
                      <span className="text-[10px] mt-0.5 opacity-70">{opt.desc}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-cinema-text-muted">Poster Image (optional)</label>
                <div className="flex items-start gap-4">
                  {posterPreview ? (
                    <div className="relative w-20 h-28 rounded-lg overflow-hidden bg-cinema-surface flex-shrink-0">
                      <img src={posterPreview} alt="Poster" className="w-full h-full object-cover" />
                      <button onClick={() => { setPosterFile(null); setPosterPreview(null); }} className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 flex items-center justify-center"><X className="w-3 h-3 text-white" /></button>
                    </div>
                  ) : (
                    <label className="w-20 h-28 rounded-lg border-2 border-dashed border-cinema-border hover:border-cinema-accent/50 flex flex-col items-center justify-center cursor-pointer transition-colors flex-shrink-0">
                      <ImageIcon className="w-5 h-5 text-cinema-text-dim mb-1" />
                      <span className="text-[10px] text-cinema-text-dim">Add poster</span>
                      <input type="file" accept={ACCEPTED_IMAGE} onChange={handlePosterSelect} className="hidden" />
                    </label>
                  )}
                  <p className="text-xs text-cinema-text-dim mt-2">JPG, PNG, or WebP under 10MB.</p>
                </div>
              </div>
            </div>

            {/* Subtitles */}
            <div className="bg-cinema-card/50 backdrop-blur-sm border border-cinema-border rounded-2xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-display text-base font-semibold text-cinema-text flex items-center gap-2">
                    <Globe className="w-4 h-4 text-cinema-secondary" /> Subtitles <span className="text-xs font-normal text-cinema-text-dim">(optional)</span>
                  </h3>
                  <p className="text-xs text-cinema-text-dim mt-0.5">Upload .srt or .vtt files</p>
                </div>
                <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-cinema-secondary/15 text-cinema-secondary hover:bg-cinema-secondary/25 border border-cinema-secondary/20 transition-colors cursor-pointer">
                  <Plus className="w-3.5 h-3.5" /> Add subtitles
                  <input type="file" accept={ACCEPTED_SUBTITLE} multiple onChange={handleSubtitleAdd} className="hidden" />
                </label>
              </div>
              {subtitleEntries.length === 0 ? (
                <div className="border-2 border-dashed border-cinema-border rounded-xl p-6 text-center">
                  <Globe className="w-8 h-8 text-cinema-text-dim mx-auto mb-2 opacity-40" />
                  <p className="text-sm text-cinema-text-dim">No subtitles added</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {subtitleEntries.map((entry) => (
                    <div key={entry.id} className="flex items-center gap-3 p-3 rounded-xl bg-cinema-surface border border-cinema-border">
                      <div className="w-8 h-8 rounded-lg bg-cinema-secondary/10 flex items-center justify-center flex-shrink-0"><Globe className="w-4 h-4 text-cinema-secondary" /></div>
                      <div className="flex-1 min-w-0"><p className="text-sm font-medium text-cinema-text truncate">{entry.file.name}</p></div>
                      <select value={entry.lang} onChange={(e) => updateSubtitleLang(entry.id, e.target.value)} className="text-xs rounded-lg bg-cinema-card border border-cinema-border px-2 py-1.5 text-cinema-text focus:outline-none cursor-pointer">
                        {LANGUAGE_OPTIONS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
                      </select>
                      <button onClick={() => setSubtitleEntries((p) => p.filter((s) => s.id !== entry.id))} className="text-cinema-text-dim hover:text-cinema-error transition-colors"><X className="w-4 h-4" /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {directError && (
              <div className="flex items-center gap-3 p-4 rounded-xl bg-cinema-error/10 border border-cinema-error/20">
                <AlertCircle className="w-5 h-5 text-cinema-error flex-shrink-0" />
                <p className="text-sm text-cinema-error">{directError}</p>
              </div>
            )}

            {uploading && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-cinema-text-muted">{uploadStage}</span>
                  <span className="text-cinema-accent font-mono">{uploadProgress}%</span>
                </div>
                <div className="h-2 bg-cinema-card rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-cinema-accent to-cinema-warm rounded-full transition-all duration-500 ease-out" style={{ width: `${uploadProgress}%` }} />
                </div>
              </div>
            )}

            <Button onClick={handleDirectUpload} disabled={!movieFile || !title.trim() || uploading} loading={uploading} size="lg" className="w-full" icon={<Upload className="w-5 h-5" />}>
              {uploading ? 'Uploading...' : 'Upload Movie'}
            </Button>
          </div>
        )}

        {/* ── TAB: Torrent / Hash ────────────────────────────── */}
        {tab === 'torrent' && (
          <div className="space-y-6 animate-fade-in">
            <div className="bg-cinema-card/50 backdrop-blur-sm border border-cinema-border rounded-2xl p-6 space-y-5">

              {/* Hash input */}
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 text-sm font-medium text-cinema-text-muted">
                  <Hash className="w-4 h-4 text-cinema-accent" /> Info Hash or Magnet Link
                </label>
                <textarea
                  placeholder={"Paste your info hash (40 hex chars) or full magnet:// URI here"}
                  value={hashInput}
                  onChange={(e) => setHashInput(e.target.value)}
                  rows={3}
                  className="w-full rounded-xl bg-cinema-card border border-cinema-border px-4 py-3 text-cinema-text placeholder:text-cinema-text-dim focus:outline-none focus:border-cinema-accent/50 focus:ring-2 focus:ring-cinema-accent/20 transition-all resize-none font-mono text-sm"
                />
                {hashInput.trim() && (
                  <div className="flex items-center gap-2 mt-1">
                    {hashInput.trim().toLowerCase().startsWith('magnet:') ? (
                      <span className="inline-flex items-center gap-1.5 text-xs text-cinema-secondary bg-cinema-secondary/10 border border-cinema-secondary/20 rounded-lg px-2.5 py-1">
                        <Magnet className="w-3 h-3" /> Magnet link detected
                      </span>
                    ) : /^[a-fA-F0-9]{40}$/.test(hashInput.trim()) ? (
                      <span className="inline-flex items-center gap-1.5 text-xs text-cinema-success bg-cinema-success/10 border border-cinema-success/20 rounded-lg px-2.5 py-1">
                        <CheckCircle className="w-3 h-3" /> Valid info hash
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs text-cinema-warn bg-cinema-warm/10 border border-cinema-warm/20 rounded-lg px-2.5 py-1">
                        <AlertTriangle className="w-3 h-3 text-cinema-warm" />
                        <span className="text-cinema-warm">Looks incomplete — should be 40 hex chars or start with magnet:</span>
                      </span>
                    )}
                  </div>
                )}
              </div>

              <Input
                id="torrentTitle"
                label="Movie Title"
                placeholder="e.g. Interstellar"
                icon={<Film className="w-4 h-4" />}
                value={torrentTitle}
                onChange={(e) => setTorrentTitle(e.target.value)}
                required
              />

              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-cinema-text-muted">Description (optional)</label>
                <textarea placeholder="What's this movie about?" value={torrentDesc} onChange={(e) => setTorrentDesc(e.target.value)} rows={2}
                  className="w-full rounded-xl bg-cinema-card border border-cinema-border px-4 py-3 text-cinema-text placeholder:text-cinema-text-dim focus:outline-none focus:border-cinema-accent/50 focus:ring-2 focus:ring-cinema-accent/20 transition-all resize-none" />
              </div>

              {/* Quality */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium text-cinema-text-muted">
                  <Gauge className="w-4 h-4 text-cinema-accent" /> Quality <span className="text-xs font-normal text-cinema-text-dim">(optional)</span>
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {QUALITY_OPTIONS.map((opt) => (
                    <button key={opt.value} type="button" onClick={() => setTorrentQuality(torrentQuality === opt.value ? null : opt.value)}
                      className={cn('flex flex-col items-center py-2.5 px-3 rounded-xl border text-xs font-medium transition-all duration-200',
                        torrentQuality === opt.value ? 'border-cinema-accent bg-cinema-accent/10 text-cinema-accent' : 'border-cinema-border bg-cinema-card/50 text-cinema-text-muted hover:border-cinema-accent/40 hover:text-cinema-text')}>
                      <span className="text-sm font-bold">{opt.label}</span>
                      <span className="text-[10px] mt-0.5 opacity-70">{opt.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Movie metadata — optional */}
              <div className="space-y-4 pt-2 border-t border-cinema-border/50">
                <p className="text-xs text-cinema-text-dim">Movie details below are optional — they&apos;ll be auto-filled if you use Search Movie first</p>

                <div className="grid grid-cols-2 gap-3">
                  {/* Release Date */}
                  <div className="space-y-1.5">
                    <label className="flex items-center gap-1.5 text-sm font-medium text-cinema-text-muted">
                      <Calendar className="w-3.5 h-3.5 text-cinema-warm" /> Release Date
                    </label>
                    <input
                      type="date"
                      value={torrentReleaseDate}
                      onChange={(e) => setTorrentReleaseDate(e.target.value)}
                      className="w-full rounded-xl bg-cinema-card border border-cinema-border px-3 py-2.5 text-sm text-cinema-text focus:outline-none focus:border-cinema-accent/50 focus:ring-2 focus:ring-cinema-accent/20 transition-all"
                    />
                  </div>

                  {/* Rating */}
                  <div className="space-y-1.5">
                    <label className="flex items-center gap-1.5 text-sm font-medium text-cinema-text-muted">
                      <Star className="w-3.5 h-3.5 text-cinema-accent" /> Rating
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="10"
                      placeholder="e.g. 8.5"
                      value={torrentRating}
                      onChange={(e) => setTorrentRating(e.target.value)}
                      className="w-full rounded-xl bg-cinema-card border border-cinema-border px-3 py-2.5 text-sm text-cinema-text placeholder:text-cinema-text-dim focus:outline-none focus:border-cinema-accent/50 focus:ring-2 focus:ring-cinema-accent/20 transition-all"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {/* Genres */}
                  <div className="space-y-1.5">
                    <label className="flex items-center gap-1.5 text-sm font-medium text-cinema-text-muted">
                      <Tag className="w-3.5 h-3.5 text-cinema-secondary" /> Genres
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Drama, Thriller"
                      value={torrentGenres}
                      onChange={(e) => setTorrentGenres(e.target.value)}
                      className="w-full rounded-xl bg-cinema-card border border-cinema-border px-3 py-2.5 text-sm text-cinema-text placeholder:text-cinema-text-dim focus:outline-none focus:border-cinema-accent/50 focus:ring-2 focus:ring-cinema-accent/20 transition-all"
                    />
                  </div>

                  {/* Runtime */}
                  <div className="space-y-1.5">
                    <label className="flex items-center gap-1.5 text-sm font-medium text-cinema-text-muted">
                      <Clock className="w-3.5 h-3.5 text-cinema-accent" /> Runtime <span className="text-cinema-text-dim text-xs font-normal">(min)</span>
                    </label>
                    <input
                      type="number"
                      min="0"
                      placeholder="e.g. 148"
                      value={torrentRuntime}
                      onChange={(e) => setTorrentRuntime(e.target.value)}
                      className="w-full rounded-xl bg-cinema-card border border-cinema-border px-3 py-2.5 text-sm text-cinema-text placeholder:text-cinema-text-dim focus:outline-none focus:border-cinema-accent/50 focus:ring-2 focus:ring-cinema-accent/20 transition-all"
                    />
                  </div>
                </div>
              </div>

              {/* Poster */}
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-cinema-text-muted">
                  Poster Image <span className="text-xs font-normal text-cinema-text-dim">(optional)</span>
                </label>
                <div className="flex items-start gap-4">
                  {torrentPosterPreview ? (
                    <div className="relative w-20 h-28 rounded-lg overflow-hidden bg-cinema-surface flex-shrink-0">
                      <img src={torrentPosterPreview} alt="Poster" className="w-full h-full object-cover" />
                      <button
                        onClick={() => { setTorrentPosterFile(null); setTorrentPosterPreview(null); }}
                        className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 flex items-center justify-center"
                      >
                        <X className="w-3 h-3 text-white" />
                      </button>
                    </div>
                  ) : (
                    <label className="w-20 h-28 rounded-lg border-2 border-dashed border-cinema-border hover:border-cinema-accent/50 flex flex-col items-center justify-center cursor-pointer transition-colors flex-shrink-0">
                      <ImageIcon className="w-5 h-5 text-cinema-text-dim mb-1" />
                      <span className="text-[10px] text-cinema-text-dim">Add poster</span>
                      <input type="file" accept={ACCEPTED_IMAGE} onChange={handleTorrentPosterSelect} className="hidden" />
                    </label>
                  )}
                  <p className="text-xs text-cinema-text-dim mt-2">Uploaded to your library before the download starts. JPG, PNG, or WebP under 10MB.</p>
                </div>
              </div>
            </div>

            {/* Subtitles */}
            <div className="bg-cinema-card/50 backdrop-blur-sm border border-cinema-border rounded-2xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-display text-base font-semibold text-cinema-text flex items-center gap-2">
                    <Globe className="w-4 h-4 text-cinema-secondary" /> Subtitles <span className="text-xs font-normal text-cinema-text-dim">(optional)</span>
                  </h3>
                  <p className="text-xs text-cinema-text-dim mt-0.5">Upload .srt or .vtt files — added after download completes</p>
                </div>
                <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-cinema-secondary/15 text-cinema-secondary hover:bg-cinema-secondary/25 border border-cinema-secondary/20 transition-colors cursor-pointer">
                  <Plus className="w-3.5 h-3.5" /> Add subtitles
                  <input type="file" accept={ACCEPTED_SUBTITLE} multiple onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    const newEntries: SubtitleEntry[] = files.map((file) => {
                      const parts = file.name.replace(/\.(srt|vtt)$/i, '').split('.');
                      const lastPart = parts[parts.length - 1].toLowerCase();
                      const detected = LANGUAGE_OPTIONS.find((l) => l.code === lastPart);
                      return { id: Math.random().toString(36).slice(2), file, lang: detected?.code || 'en', label: detected?.label || 'English' };
                    });
                    setTorrentSubtitles((prev) => [...prev, ...newEntries]);
                    e.target.value = '';
                  }} className="hidden" />
                </label>
              </div>
              {torrentSubtitles.length === 0 ? (
                <div className="border-2 border-dashed border-cinema-border rounded-xl p-6 text-center">
                  <Globe className="w-8 h-8 text-cinema-text-dim mx-auto mb-2 opacity-40" />
                  <p className="text-sm text-cinema-text-dim">No subtitles added</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {torrentSubtitles.map((entry) => (
                    <div key={entry.id} className="flex items-center gap-3 p-3 rounded-xl bg-cinema-surface border border-cinema-border">
                      <div className="w-8 h-8 rounded-lg bg-cinema-secondary/10 flex items-center justify-center flex-shrink-0"><Globe className="w-4 h-4 text-cinema-secondary" /></div>
                      <div className="flex-1 min-w-0"><p className="text-sm font-medium text-cinema-text truncate">{entry.file.name}</p></div>
                      <select value={entry.lang} onChange={(e) => updateSubtitleLang(entry.id, e.target.value, setTorrentSubtitles)} className="text-xs rounded-lg bg-cinema-card border border-cinema-border px-2 py-1.5 text-cinema-text focus:outline-none cursor-pointer">
                        {LANGUAGE_OPTIONS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
                      </select>
                      <button onClick={() => setTorrentSubtitles((p) => p.filter((s) => s.id !== entry.id))} className="text-cinema-text-dim hover:text-cinema-error transition-colors"><X className="w-4 h-4" /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Auto-download subtitles language preference */}
            {torrentImdbId && (
              <div className="bg-cinema-card/50 backdrop-blur-sm border border-cinema-accent/20 rounded-2xl p-6 space-y-4">
                <div>
                  <h3 className="font-display text-base font-semibold text-cinema-text flex items-center gap-2">
                    <Download className="w-4 h-4 text-cinema-accent" /> Auto-Download Subtitles
                  </h3>
                  <p className="text-xs text-cinema-text-dim mt-0.5">We&apos;ll automatically search and download subtitles from OpenSubtitles when the movie finishes downloading</p>
                </div>

                <div className="space-y-3">
                  {/* English — always included, locked */}
                  <div className="flex items-center gap-3 p-3 rounded-xl bg-cinema-surface border border-cinema-border">
                    <div className="w-8 h-8 rounded-lg bg-cinema-accent/10 flex items-center justify-center flex-shrink-0">
                      <Globe className="w-4 h-4 text-cinema-accent" />
                    </div>
                    <span className="flex-1 text-sm font-medium text-cinema-text">English</span>
                    <span className="text-xs text-cinema-accent px-2 py-0.5 rounded bg-cinema-accent/10">Default</span>
                  </div>

                  {/* Second language — user picks */}
                  <div className="flex items-center gap-3 p-3 rounded-xl bg-cinema-surface border border-cinema-border">
                    <div className="w-8 h-8 rounded-lg bg-cinema-secondary/10 flex items-center justify-center flex-shrink-0">
                      <Globe className="w-4 h-4 text-cinema-secondary" />
                    </div>
                    <span className="flex-1 text-sm text-cinema-text-muted">Second language</span>
                    <select
                      value={subtitleSecondLang}
                      onChange={async (e) => {
                        const lang = e.target.value;
                        setSubtitleSecondLang(lang);
                        // Save preference to profile
                        const { data: { user } } = await supabase.auth.getUser();
                        if (user) {
                          const langs = lang ? ['en', lang] : ['en'];
                          await supabase
                            .from('profiles')
                            .update({ subtitle_languages: langs })
                            .eq('user_id', user.id);
                          setSubtitleLangSaved(true);
                          setTimeout(() => setSubtitleLangSaved(false), 2000);
                        }
                      }}
                      className="text-xs rounded-lg bg-cinema-card border border-cinema-border px-2 py-1.5 text-cinema-text focus:outline-none cursor-pointer"
                    >
                      <option value="">None</option>
                      {LANGUAGE_OPTIONS.filter((l) => l.code !== 'en').map((l) => (
                        <option key={l.code} value={l.code}>{l.label}</option>
                      ))}
                    </select>
                    {subtitleLangSaved && (
                      <span className="text-[10px] text-cinema-success animate-fade-in">Saved!</span>
                    )}
                  </div>
                </div>
                <p className="text-[11px] text-cinema-text-dim">Your language preference is saved for future downloads.</p>
              </div>
            )}

            {/* How it works */}
            <div className="flex items-start gap-3 p-4 rounded-xl bg-cinema-secondary/8 border border-cinema-secondary/20">
              <Zap className="w-4 h-4 text-cinema-secondary flex-shrink-0 mt-0.5" />
              <div className="text-xs text-cinema-text-dim space-y-1">
                <p className="text-cinema-text-muted font-medium">How this works</p>
                <p>We download the torrent on our servers and store it directly in your movie library. You can close this page — the job runs in the background and will be waiting for you in <strong className="text-cinema-text">Active Jobs</strong>.</p>
              </div>
            </div>

            {/* Submit phase banner — shows service startup messages */}
            <SubmitPhaseBanner phase={submitPhase} />

            {/* Error */}
            {torrentError && (
              <div className="flex items-center gap-3 p-4 rounded-xl bg-cinema-error/10 border border-cinema-error/20">
                <AlertCircle className="w-5 h-5 text-cinema-error flex-shrink-0" />
                <p className="text-sm text-cinema-error">{torrentError}</p>
              </div>
            )}

            <Button
              onClick={handleTorrentSubmit}
              disabled={!hashInput.trim() || !torrentTitle.trim() || isSubmitting}
              loading={isSubmitting}
              size="lg"
              className="w-full"
              icon={isSubmitting ? undefined : <Download className="w-5 h-5" />}
            >
              {isSubmitting ? PHASE_LABELS[submitPhase] : 'Start Download'}
            </Button>
          </div>
        )}

        {/* ── TAB: Active Jobs ───────────────────────────────── */}
        {tab === 'jobs' && (
          <div className="space-y-4 animate-fade-in">
            {activeJobs.length === 0 ? (
              <div className="text-center py-16">
                <div className="w-16 h-16 rounded-2xl bg-cinema-card border border-cinema-border flex items-center justify-center mx-auto mb-4">
                  <FolderOpen className="w-8 h-8 text-cinema-text-dim opacity-40" />
                </div>
                <p className="text-cinema-text-muted font-medium">No active jobs</p>
                <p className="text-sm text-cinema-text-dim mt-1">Start a torrent download and it'll appear here</p>
                <button onClick={() => setTab('torrent')} className="mt-4 inline-flex items-center gap-2 text-sm text-cinema-accent hover:text-cinema-accent-light transition-colors">
                  <Magnet className="w-4 h-4" /> Start a new download
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-sm text-cinema-text-muted">
                    {activeJobs.length} job{activeJobs.length !== 1 ? 's' : ''}
                    {activeCount > 0 && <span className="text-cinema-secondary ml-1.5">· {activeCount} running</span>}
                  </p>
                  {activeJobs.some((j) => j.job && TERMINAL.has(j.job.stage)) && (
                    <button
                      onClick={() => setActiveJobs((p) => p.filter((j) => !j.job || !TERMINAL.has(j.job.stage)))}
                      className="text-xs text-cinema-text-dim hover:text-cinema-text-muted transition-colors flex items-center gap-1"
                    >
                      <X className="w-3.5 h-3.5" /> Clear finished
                    </button>
                  )}
                </div>

                {activeJobs.map((aj) => (
                  <JobCard
                    key={aj.jobId}
                    activeJob={aj}
                    onCancel={handleCancel}
                    onGoToMovie={(movieId) => router.push(`/movie/${movieId}`)}
                  />
                ))}
              </>
            )}
          </div>
        )}

      </main>
    </div>
  );
}