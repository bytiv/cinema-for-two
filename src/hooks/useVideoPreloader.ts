'use client';

import { useEffect, useRef, useCallback, useState } from 'react';

const PRELOAD_AHEAD_SECONDS = 120;
const CHUNK_SIZE = 4 * 1024 * 1024;
const MAX_BUFFER_BYTES = 80 * 1024 * 1024;
const MAX_RETRIES = 4;
const RETRY_DELAY_MS = 1500;

export type BufferHealth = 'starved' | 'low' | 'good' | 'full';

interface PreloaderState {
  bufferHealth: BufferHealth;
  bufferedAhead: number;
  isStalled: boolean;
  isRecovering: boolean;
  downloadSpeed: number;
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

  const abortRef        = useRef<AbortController | null>(null);
  const stallTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef   = useRef(0);
  const isActiveRef     = useRef(false);
  const speedSamplesRef = useRef<number[]>([]);
  const fileSizeRef     = useRef<number | null>(null);
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
    if (ahead < 5)  return 'starved';
    if (ahead < 20) return 'low';
    if (ahead < 90) return 'good';
    return 'full';
  }, []);

  const fetchFileSize = useCallback(async (url: string): Promise<number | null> => {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      const cl = res.headers.get('content-length');
      return cl ? parseInt(cl, 10) : null;
    } catch {
      return null;
    }
  }, []);

  const fetchRange = useCallback(async (
    url: string, start: number, end: number, signal: AbortSignal
  ): Promise<{ bytes: number; durationMs: number } | null> => {
    const t0 = Date.now();
    try {
      const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` }, signal });
      if (!res.ok && res.status !== 206) return null;
      const buf = await res.arrayBuffer();
      return { bytes: buf.byteLength, durationMs: Date.now() - t0 };
    } catch (e: any) {
      if (e?.name === 'AbortError') return null;
      return null;
    }
  }, []);

  const startPreloading = useCallback(async (url: string) => {
    if (!enabled) return;
    isActiveRef.current = true;

    if (!fileSizeRef.current) {
      fileSizeRef.current = await fetchFileSize(url);
    }

    const loop = async () => {
      while (isActiveRef.current) {
        const video = videoRef.current;
        if (!video) { await sleep(500); continue; }

        const ahead = getBufferedAhead();
        const health = computeHealth(ahead);
        setState(prev => ({ ...prev, bufferedAhead: ahead, bufferHealth: health }));

        if (ahead >= PRELOAD_AHEAD_SECONDS || video.ended) { await sleep(2000); continue; }
        if (fetchedBytesRef.current >= MAX_BUFFER_BYTES)   { await sleep(3000); continue; }

        const fileSize = fileSizeRef.current;
        if (!fileSize) { await sleep(1000); continue; }

        const bufferedEnd = (() => {
          for (let i = 0; i < video.buffered.length; i++) {
            if (video.buffered.start(i) <= video.currentTime + 0.5) return video.buffered.end(i);
          }
          return video.currentTime;
        })();

        const duration  = video.duration || 1;
        const byteStart = Math.floor((bufferedEnd / duration) * fileSize);
        const byteEnd   = Math.min(byteStart + CHUNK_SIZE - 1, fileSize - 1);

        if (byteStart >= fileSize) { await sleep(2000); continue; }

        abortRef.current = new AbortController();
        const result = await fetchRange(url, byteStart, byteEnd, abortRef.current.signal);

        if (result) {
          fetchedBytesRef.current += result.bytes;
          retryCountRef.current = 0;
          const speedMbps = (result.bytes * 8) / (result.durationMs / 1000) / 1_000_000;
          speedSamplesRef.current = [...speedSamplesRef.current.slice(-4), speedMbps];
          const avgSpeed = speedSamplesRef.current.reduce((a, b) => a + b, 0) / speedSamplesRef.current.length;
          setState(prev => ({ ...prev, downloadSpeed: parseFloat(avgSpeed.toFixed(1)) }));
        } else {
          retryCountRef.current++;
          const delay = retryCountRef.current < MAX_RETRIES ? RETRY_DELAY_MS * retryCountRef.current : 5000;
          if (retryCountRef.current >= MAX_RETRIES) retryCountRef.current = 0;
          await sleep(delay);
        }

        await sleep(100);
      }
    };

    loop().catch(() => {});
  }, [enabled, videoRef, getBufferedAhead, computeHealth, fetchFileSize, fetchRange]);

  // ── Stall detection — NO video.load() to avoid position jumping ──────────
  const setupStallDetection = useCallback((video: HTMLVideoElement) => {
    const handleWaiting = () => {
      setState(prev => ({ ...prev, isStalled: true }));

      if (stallTimerRef.current) clearTimeout(stallTimerRef.current);
      stallTimerRef.current = setTimeout(() => {
        // Only act if still actually stalled (not paused by user)
        if (video.paused || video.readyState >= 3) return;

        setState(prev => ({ ...prev, isRecovering: true }));

        // Gentle nudge forward by 0.1s — avoids visible jump but may help decoder
        try {
          const bump = Math.min(video.currentTime + 0.1, video.duration - 0.5);
          video.currentTime = bump;
        } catch {}

        // If still stalled after another 3s, nudge a bit more
        if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current);
        recoveryTimerRef.current = setTimeout(() => {
          if (!video.paused && video.readyState < 3) {
            try {
              const bump2 = Math.min(video.currentTime + 0.5, video.duration - 0.5);
              video.currentTime = bump2;
            } catch {}
          }
          setState(prev => ({ ...prev, isRecovering: false }));
        }, 3000);
      }, 1500); // wait 1.5s before attempting recovery
    };

    const handlePlaying = () => {
      setState(prev => ({ ...prev, isStalled: false, isRecovering: false }));
      if (stallTimerRef.current) clearTimeout(stallTimerRef.current);
      if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current);
    };

    const handleProgress = () => {
      const ahead = getBufferedAhead();
      setState(prev => ({ ...prev, bufferedAhead: ahead, bufferHealth: computeHealth(ahead) }));
    };

    video.addEventListener('waiting',  handleWaiting);
    video.addEventListener('playing',  handlePlaying);
    video.addEventListener('canplay',  handlePlaying);
    video.addEventListener('progress', handleProgress);

    return () => {
      video.removeEventListener('waiting',  handleWaiting);
      video.removeEventListener('playing',  handlePlaying);
      video.removeEventListener('canplay',  handlePlaying);
      video.removeEventListener('progress', handleProgress);
    };
  }, [getBufferedAhead, computeHealth]);

  const applyVideoHints = useCallback((video: HTMLVideoElement) => {
    video.preload = 'auto';
  }, []);

  useEffect(() => {
    if (!src || !enabled) return;
    const video = videoRef.current;
    if (!video) return;

    applyVideoHints(video);
    const cleanup = setupStallDetection(video);

    fetchedBytesRef.current = 0;
    fileSizeRef.current     = null;
    startPreloading(src);

    return () => {
      isActiveRef.current = false;
      abortRef.current?.abort();
      if (stallTimerRef.current)    clearTimeout(stallTimerRef.current);
      if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current);
      cleanup();
    };
  }, [src, enabled]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;
    const handleSeeked = () => { fetchedBytesRef.current = 0; };
    video.addEventListener('seeked', handleSeeked);
    return () => video.removeEventListener('seeked', handleSeeked);
  }, [src, videoRef]);

  return state;
}

function sleep(ms: number): Promise<void> {
  return new Promise(res => setTimeout(res, ms));
}