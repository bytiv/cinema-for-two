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
  Server, Wifi, WifiOff,
} from 'lucide-react';

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

type Tab = 'direct' | 'torrent' | 'jobs';

// ─────────────────────────────────────────────────────────────
// Submit phase — shown instead of the spinner label
// ─────────────────────────────────────────────────────────────

type SubmitPhase =
  | 'idle'
  | 'uploading-poster'   // uploading poster to Azure
  | 'uploading-subs'     // uploading subtitles to Azure
  | 'service-check'      // checking if container is alive
  | 'service-starting'   // container is cold — starting up
  | 'service-connecting' // container started, waiting for health
  | 'submitting'         // sending job to Python
  | 'done';

const PHASE_LABELS: Record<SubmitPhase, string> = {
  idle:                '',
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
  if (stage === 'Ready')                return 'text-cinema-success bg-cinema-success/10 border-cinema-success/20';
  if (stage === 'Failed')               return 'text-cinema-error bg-cinema-error/10 border-cinema-error/20';
  if (stage === 'Cancelled')            return 'text-cinema-text-dim bg-cinema-card border-cinema-border';
  if (stage === 'Uploading to storage') return 'text-cinema-warm bg-cinema-warm/10 border-cinema-warm/20';
  if (stage === 'Queued')               return 'text-cinema-text-muted bg-cinema-surface border-cinema-border';
  return 'text-cinema-secondary bg-cinema-secondary/10 border-cinema-secondary/20';
}

function stageIcon(stage: string) {
  if (stage === 'Ready')                  return <CheckCircle className="w-3.5 h-3.5" />;
  if (stage === 'Failed')                 return <AlertCircle className="w-3.5 h-3.5" />;
  if (stage === 'Cancelled')              return <Ban className="w-3.5 h-3.5" />;
  if (stage === 'Uploading to storage')   return <HardDrive className="w-3.5 h-3.5" />;
  if (stage === 'Downloading to servers') return <Download className="w-3.5 h-3.5" />;
  if (stage === 'Queued')                 return <Clock className="w-3.5 h-3.5" />;
  return <Loader2 className="w-3.5 h-3.5 animate-spin" />;
}

// ─────────────────────────────────────────────────────────────
// Sub-component: Submit phase banner
// ─────────────────────────────────────────────────────────────

function SubmitPhaseBanner({ phase }: { phase: SubmitPhase }) {
  if (phase === 'idle' || phase === 'done') return null;

  const isServicePhase = phase === 'service-check' || phase === 'service-starting' || phase === 'service-connecting';

  return (
    <div className={cn(
      'flex items-center gap-3 p-4 rounded-xl border transition-all duration-300',
      isServicePhase
        ? 'bg-cinema-secondary/8 border-cinema-secondary/20'
        : 'bg-cinema-accent/8 border-cinema-accent/20',
    )}>
      <div className="flex-shrink-0">
        {phase === 'service-starting'   && <Server className="w-4 h-4 text-cinema-secondary animate-pulse" />}
        {phase === 'service-connecting' && <Wifi   className="w-4 h-4 text-cinema-secondary animate-pulse" />}
        {phase === 'service-check'      && <Loader2 className="w-4 h-4 text-cinema-secondary animate-spin" />}
        {!isServicePhase                && <Loader2 className="w-4 h-4 text-cinema-accent animate-spin" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className={cn(
          'text-sm font-medium',
          isServicePhase ? 'text-cinema-secondary' : 'text-cinema-accent',
        )}>
          {PHASE_LABELS[phase]}
        </p>
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
  const stage      = job?.stage ?? 'Queued';
  const isTerminal = TERMINAL.has(stage);
  const isQueued   = stage === 'Queued';

  return (
    <div className={cn(
      'rounded-2xl border bg-cinema-card/60 backdrop-blur-sm overflow-hidden transition-all duration-300',
      stage === 'Ready'  ? 'border-cinema-success/30' :
      stage === 'Failed' ? 'border-cinema-error/30'   :
      isQueued           ? 'border-cinema-border/60'  : 'border-cinema-border',
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
          {stage}
        </span>
      </div>

      {/* Queued notice */}
      {isQueued && (
        <div className="mx-4 mb-3 flex items-start gap-2.5 p-3 rounded-xl bg-cinema-surface border border-cinema-border">
          <Clock className="w-4 h-4 text-cinema-text-dim flex-shrink-0 mt-0.5" />
          <p className="text-xs text-cinema-text-muted leading-relaxed">
            Your download is queued — it will start automatically once a slot is free.
          </p>
        </div>
      )}

      {/* Warning banner */}
      {job?.warning && (
        <div className="mx-4 mb-3 flex items-start gap-2.5 p-3 rounded-xl bg-cinema-warm/8 border border-cinema-warm/20">
          <AlertTriangle className="w-4 h-4 text-cinema-warm flex-shrink-0 mt-0.5" />
          <p className="text-xs text-cinema-warm leading-relaxed">{job.warning}</p>
        </div>
      )}

      {/* Notification */}
      {job?.notification && !isQueued && (
        <p className="px-4 pb-3 text-sm text-cinema-text-muted">{job.notification}</p>
      )}

      {/* Progress bars */}
      {job && !isTerminal && !isQueued && (
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
  const [tab, setTab] = useState<Tab>('direct');

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

      const { data: rows } = await supabase
        .from('ingest_jobs')
        .select('*')
        .eq('user_id', user.id)
        .in('status', ['pending', 'submitted', 'queued', 'running', 'uploading'])
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

      // Mark stale jobs as failed so they don't block the queue forever
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
        completed:  'Ready',
        failed:     'Failed',
        cancelled:  'Cancelled',
        queued:     'Queued',
        running:    'Downloading to servers',
        uploading:  'Uploading to storage',
        submitted:  'Queued',
        pending:    'Queued',
      };

      const stage = statusToStage[row.status] ?? 'Queued';

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
          <p className="text-cinema-text-muted">Upload a file directly or fetch one by torrent hash</p>
        </div>

        {/* Tab switcher */}
        <div className="flex items-center gap-1 p-1 rounded-2xl bg-cinema-card/60 border border-cinema-border backdrop-blur-sm mb-6">
          {([
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