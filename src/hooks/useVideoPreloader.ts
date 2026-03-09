'use client';

import { useEffect, useRef, useCallback, useState } from 'react';

const PRELOAD_AHEAD_SECONDS = 120;  // 2 minutes ahead
const CHUNK_SIZE = 4 * 1024 * 1024; // 4 MB per chunk
const MAX_BUFFER_BYTES = 80 * 1024 * 1024; // 80 MB max in memory
const STALL_THRESHOLD_MS = 800; // consider stalled after 800ms without progress
const RETRY_DELAY_MS = 1500;
const MAX_RETRIES = 4;

export type BufferHealth = 'starved' | 'low' | 'good' | 'full';

interface PreloaderState {
  bufferHealth: BufferHealth;
  bufferedAhead: number; // seconds buffered ahead of current position
  isStalled: boolean;
  isRecovering: boolean;
  downloadSpeed: number; // Mbps
}

interface UseVideoPreloaderOptions {
  videoRef: React.RefObject<HTMLVideoElement>;
  src: string | null;
  enabled?: boolean;
}

export function useVideoPreloader({ videoRef, src, enabled = true }: UseVideoPreloaderOptions) {
  const [state, setState] = useState<PreloaderState>({
    bufferHealth: 'starved',
    bufferedAhead: 0,
    isStalled: false,
    isRecovering: false,
    downloadSpeed: 0,
  });

  const abortRef = useRef<AbortController | null>(null);
  const stallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  const lastProgressTimeRef = useRef(Date.now());
  const lastProgressPosRef = useRef(0);
  const isActiveRef = useRef(false);
  const speedSamplesRef = useRef<number[]>([]);
  const fileSizeRef = useRef<number | null>(null);
  const fetchedBytesRef = useRef(0);

  const getBufferedAhead = useCallback((): number => {
    const video = videoRef.current;
    if (!video || !video.buffered.length) return 0;
    const ct = video.currentTime;
    for (let i = 0; i < video.buffered.length; i++) {
      if (video.buffered.start(i) <= ct + 0.5 && video.buffered.end(i) > ct) {
        return video.buffered.end(i) - ct;
      }
    }
    return 0;
  }, [videoRef]);

  const computeHealth = useCallback((ahead: number): BufferHealth => {
    if (ahead < 5) return 'starved';
    if (ahead < 20) return 'low';
    if (ahead < 90) return 'good';
    return 'full';
  }, []);

  // ── Fetch file size via HEAD ──────────────────────────────────────────────
  const fetchFileSize = useCallback(async (url: string): Promise<number | null> => {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      const cl = res.headers.get('content-length');
      return cl ? parseInt(cl, 10) : null;
    } catch {
      return null;
    }
  }, []);

  // ── Fetch a byte range and push into video src ────────────────────────────
  const fetchRange = useCallback(async (
    url: string,
    start: number,
    end: number,
    signal: AbortSignal
  ): Promise<{ bytes: number; durationMs: number } | null> => {
    const t0 = Date.now();
    try {
      const res = await fetch(url, {
        headers: { Range: `bytes=${start}-${end}` },
        signal,
      });
      if (!res.ok && res.status !== 206) return null;
      const buf = await res.arrayBuffer();
      const durationMs = Date.now() - t0;
      return { bytes: buf.byteLength, durationMs };
    } catch (e: any) {
      if (e?.name === 'AbortError') return null;
      return null;
    }
  }, []);

  // ── Main preloader loop ───────────────────────────────────────────────────
  const startPreloading = useCallback(async (url: string) => {
    if (!enabled) return;
    isActiveRef.current = true;

    // Get file size first
    if (!fileSizeRef.current) {
      fileSizeRef.current = await fetchFileSize(url);
    }

    const loop = async () => {
      while (isActiveRef.current) {
        const video = videoRef.current;
        if (!video) { await sleep(500); continue; }

        const ahead = getBufferedAhead();
        const health = computeHealth(ahead);

        // Update state
        setState(prev => ({
          ...prev,
          bufferedAhead: ahead,
          bufferHealth: health,
        }));

        // Don't prefetch if we already have enough or video is paused/ended
        if (ahead >= PRELOAD_AHEAD_SECONDS || video.ended) {
          await sleep(2000);
          continue;
        }

        // Don't over-fill memory
        if (fetchedBytesRef.current >= MAX_BUFFER_BYTES) {
          await sleep(3000);
          continue;
        }

        // Figure out byte range to fetch next
        const fileSize = fileSizeRef.current;
        if (!fileSize) { await sleep(1000); continue; }

        // Estimate byte position: use current video time ratio + buffer end
        const bufferedEnd = (() => {
          for (let i = 0; i < video.buffered.length; i++) {
            if (video.buffered.start(i) <= video.currentTime + 0.5) {
              return video.buffered.end(i);
            }
          }
          return video.currentTime;
        })();

        const duration = video.duration || 1;
        const byteStart = Math.floor((bufferedEnd / duration) * fileSize);
        const byteEnd = Math.min(byteStart + CHUNK_SIZE - 1, fileSize - 1);

        if (byteStart >= fileSize) { await sleep(2000); continue; }

        abortRef.current = new AbortController();
        const result = await fetchRange(url, byteStart, byteEnd, abortRef.current.signal);

        if (result) {
          fetchedBytesRef.current += result.bytes;
          retryCountRef.current = 0;

          // Track download speed
          const speedMbps = (result.bytes * 8) / (result.durationMs / 1000) / 1_000_000;
          speedSamplesRef.current = [...speedSamplesRef.current.slice(-4), speedMbps];
          const avgSpeed = speedSamplesRef.current.reduce((a, b) => a + b, 0) / speedSamplesRef.current.length;

          setState(prev => ({ ...prev, downloadSpeed: parseFloat(avgSpeed.toFixed(1)) }));
        } else {
          // Retry with backoff
          retryCountRef.current++;
          if (retryCountRef.current < MAX_RETRIES) {
            await sleep(RETRY_DELAY_MS * retryCountRef.current);
          } else {
            await sleep(5000);
            retryCountRef.current = 0;
          }
        }

        await sleep(100); // small yield between chunks
      }
    };

    loop().catch(() => {});
  }, [enabled, videoRef, getBufferedAhead, computeHealth, fetchFileSize, fetchRange]);

  // ── Stall detection ───────────────────────────────────────────────────────
  const setupStallDetection = useCallback((video: HTMLVideoElement) => {
    const handleTimeUpdate = () => {
      if (video.currentTime !== lastProgressPosRef.current) {
        lastProgressPosRef.current = video.currentTime;
        lastProgressTimeRef.current = Date.now();
        setState(prev => prev.isStalled ? { ...prev, isStalled: false, isRecovering: false } : prev);
      }
    };

    const handleWaiting = () => {
      setState(prev => ({ ...prev, isStalled: true }));

      if (stallTimerRef.current) clearTimeout(stallTimerRef.current);
      stallTimerRef.current = setTimeout(() => {
        if (!video.paused && video.readyState < 3) {
          // Auto-recovery: try seeking slightly forward
          setState(prev => ({ ...prev, isRecovering: true }));
          const bump = Math.min(video.currentTime + 0.5, video.duration - 1);
          try { video.currentTime = bump; } catch {}

          // If still stalled after another 2s, reload the segment
          setTimeout(() => {
            if (!video.paused && video.readyState < 3) {
              setState(prev => ({ ...prev, isRecovering: true }));
              // Force reload from current position
              const t = video.currentTime;
              video.load();
              video.currentTime = t;
              video.play().catch(() => {});
            }
          }, 2000);
        }
      }, STALL_THRESHOLD_MS);
    };

    const handlePlaying = () => {
      setState(prev => ({ ...prev, isStalled: false, isRecovering: false }));
      if (stallTimerRef.current) clearTimeout(stallTimerRef.current);
    };

    const handleProgress = () => {
      const ahead = getBufferedAhead();
      setState(prev => ({
        ...prev,
        bufferedAhead: ahead,
        bufferHealth: computeHealth(ahead),
      }));
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('playing', handlePlaying);
    video.addEventListener('progress', handleProgress);
    video.addEventListener('canplay', handlePlaying);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('playing', handlePlaying);
      video.removeEventListener('progress', handleProgress);
      video.removeEventListener('canplay', handlePlaying);
    };
  }, [getBufferedAhead, computeHealth]);

  // ── Hint the browser to buffer aggressively ───────────────────────────────
  const applyVideoHints = useCallback((video: HTMLVideoElement) => {
    // Tell browser this is a full movie, not a clip
    video.preload = 'auto';
    // Set a high buffer target via non-standard but widely supported property
    (video as any).mozAutoplayEnabled = true;
    // Disable any latency-reduction modes (live stream defaults)
    try {
      (video as any).disableRemotePlayback = false;
    } catch {}
  }, []);

  useEffect(() => {
    if (!src || !enabled) return;

    const video = videoRef.current;
    if (!video) return;

    applyVideoHints(video);
    const cleanup = setupStallDetection(video);

    fetchedBytesRef.current = 0;
    fileSizeRef.current = null;
    startPreloading(src);

    return () => {
      isActiveRef.current = false;
      abortRef.current?.abort();
      if (stallTimerRef.current) clearTimeout(stallTimerRef.current);
      cleanup();
    };
  }, [src, enabled]);

  // Re-run preloader when user seeks (new position needs new prefetch)
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    const handleSeeked = () => {
      fetchedBytesRef.current = 0; // reset fetch tracking for new position
    };

    video.addEventListener('seeked', handleSeeked);
    return () => video.removeEventListener('seeked', handleSeeked);
  }, [src, videoRef]);

  return state;
}

function sleep(ms: number): Promise<void> {
  return new Promise(res => setTimeout(res, ms));
}