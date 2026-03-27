'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize, SkipBack, SkipForward, Subtitles, Settings2, Gauge } from 'lucide-react';
import { formatDuration } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { useVideoPreloader } from '@/hooks/useVideoPreloader';

// ── Types ────────────────────────────────────────────────────────────────────

interface SubtitleTrack { label: string; lang: string; url: string; }
interface SubtitleStyle {
  size: number; opacity: number; bg: 'black' | 'dark' | 'none';
  position: 'bottom' | 'top'; color: 'white' | 'yellow' | 'cyan';
}

const DEFAULT_SUB_STYLE: SubtitleStyle = { size: 24, opacity: 1, bg: 'dark', position: 'bottom', color: 'white' };

function loadSubStyle(): SubtitleStyle {
  try {
    const raw = document.cookie.split('; ').find(r => r.startsWith('subStyle='));
    if (raw) return { ...DEFAULT_SUB_STYLE, ...JSON.parse(decodeURIComponent(raw.split('=')[1])) };
  } catch {}
  return DEFAULT_SUB_STYLE;
}

function saveSubStyle(style: SubtitleStyle) {
  const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toUTCString();
  document.cookie = `subStyle=${encodeURIComponent(JSON.stringify(style))}; expires=${expires}; path=/; SameSite=Lax`;
}

interface VideoPlayerProps {
  src: string;
  subtitles?: SubtitleTrack[];
  initialTime?: number;
  onPlaybackEvent?: (event: { type: 'play' | 'pause' | 'seek'; timestamp: number }) => void;
  externalControl?: { type: 'play' | 'pause' | 'seek'; timestamp: number } | null;
  /** Available quality variants with streaming URLs (null = single quality, no selector) */
  qualityVariants?: { quality: string; url: string }[] | null;
  /** HLS master playlist URL — when provided, player uses hls.js for adaptive streaming */
  hlsMasterUrl?: string | null;
  className?: string;
}

const BG_MAP    = { black: 'rgba(0,0,0,0.85)', dark: 'rgba(0,0,0,0.45)', none: 'transparent' };
const COLOR_MAP = { white: '#ffffff', yellow: '#fde68a', cyan: '#a5f3fc' };

const QUALITY_ORDER: Record<string, number> = { '480p': 0, '720p': 1, '1080p': 2, '4K': 3 };

function requestFullscreen(el: HTMLElement) {
  if (el.requestFullscreen)               return el.requestFullscreen();
  if ((el as any).webkitRequestFullscreen) return (el as any).webkitRequestFullscreen();
  if ((el as any).webkitEnterFullscreen)   return (el as any).webkitEnterFullscreen();
}
function exitFullscreen() {
  if (document.exitFullscreen)               return document.exitFullscreen();
  if ((document as any).webkitExitFullscreen) return (document as any).webkitExitFullscreen();
}
function getFullscreenElement() {
  return document.fullscreenElement || (document as any).webkitFullscreenElement || null;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function VideoPlayer({ src, subtitles = [], initialTime, onPlaybackEvent, externalControl, qualityVariants, hlsMasterUrl, className }: VideoPlayerProps) {
  const videoRef       = useRef<HTMLVideoElement>(null);  // Player A
  const videoRefB      = useRef<HTMLVideoElement>(null);  // Player B (standby for quality switching)
  const containerRef   = useRef<HTMLDivElement>(null);
  const progressRef    = useRef<HTMLDivElement>(null);
  const hideTimeoutRef = useRef<NodeJS.Timeout>();
  const isExternalRef  = useRef(false);
  const lastTapRef     = useRef<number>(0);
  const hlsRef         = useRef<any>(null);

  const isSeeking      = useRef(false);
  const seekTarget     = useRef<number | null>(null);
  const lastExternalControl = useRef<string | null>(null);

  const [isPlaying,    setIsPlaying]    = useState(false);
  const [currentTime,  setCurrentTime]  = useState(0);
  const [duration,     setDuration]     = useState(0);
  const [volume,       setVolume]       = useState(1);
  const [isMuted,      setIsMuted]      = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [buffered,     setBuffered]     = useState(0);
  const [isMobile,     setIsMobile]     = useState(false);
  const [isWaiting,    setIsWaiting]    = useState(false);

  const [hoverTime,    setHoverTime]    = useState<number | null>(null);
  const [hoverX,       setHoverX]       = useState(0);

  const [activeSubtitle,   setActiveSubtitle]   = useState<string | null>(subtitles.length > 0 ? subtitles[0].lang : null);
  const [currentCue,       setCurrentCue]       = useState<string | null>(null);
  const [showSubMenu,      setShowSubMenu]      = useState(false);
  const [showSubSettings,  setShowSubSettings]  = useState(false);
  const [subStyle, setSubStyle] = useState<SubtitleStyle>(DEFAULT_SUB_STYLE);

  // ── Quality state ──────────────────────────────────────────────────────────
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  // 'auto' = adaptive (HLS or buffer-based), or a specific quality like '720p', '1080p'
  const [selectedQuality, setSelectedQuality]  = useState<string>('auto');
  // Current quality being played (for display, updated by HLS level switches or auto logic)
  const [currentQualityLabel, setCurrentQualityLabel] = useState<string | null>(null);
  // Whether we're using HLS mode
  const [hlsActive, setHlsActive] = useState(false);

  const hasVariants = qualityVariants && qualityVariants.length > 1;
  const hasHls = !!hlsMasterUrl;
  const showQualitySelector = hasVariants || hasHls;

  useEffect(() => {
    setSubStyle(loadSubStyle());
  }, []);

  const updateSubStyle = useCallback((updater: (prev: SubtitleStyle) => SubtitleStyle) => {
    setSubStyle(prev => {
      const next = updater(prev);
      saveSubStyle(next);
      return next;
    });
  }, []);

  const preloader = useVideoPreloader({ videoRef, src: hlsActive ? '' : src, enabled: !hlsActive });

  // Set initial quality label based on available variants
  useEffect(() => {
    if (currentQualityLabel) return; // already set
    if (qualityVariants && qualityVariants.length > 1) {
      const sorted = [...qualityVariants].sort(
        (a, b) => (QUALITY_ORDER[b.quality] ?? 0) - (QUALITY_ORDER[a.quality] ?? 0),
      );
      setCurrentQualityLabel(`Auto (${sorted[0].quality})`);
    } else if (qualityVariants && qualityVariants.length === 1) {
      setCurrentQualityLabel(qualityVariants[0].quality);
    }
  }, [qualityVariants]);

  useEffect(() => {
    const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    setIsMobile(mobile);
  }, []);

  useEffect(() => {
    const update = () => setIsFullscreen(!!getFullscreenElement());
    document.addEventListener('fullscreenchange', update);
    document.addEventListener('webkitfullscreenchange', update);
    return () => {
      document.removeEventListener('fullscreenchange', update);
      document.removeEventListener('webkitfullscreenchange', update);
    };
  }, []);

  // ── HLS.js initialization ──────────────────────────────────────────────────
  useEffect(() => {
    if (!hlsMasterUrl || !videoRef.current) {
      setHlsActive(false);
      return;
    }

    // Safari has native HLS support — use it directly
    const video = videoRef.current;
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = hlsMasterUrl;
      setHlsActive(true);
      setCurrentQualityLabel('Auto');
      return;
    }

    // For other browsers, dynamically import hls.js
    let destroyed = false;
    (async () => {
      try {
        const Hls = (await import('hls.js')).default;
        if (destroyed || !Hls.isSupported()) {
          // hls.js not supported — fall back to direct MP4
          setHlsActive(false);
          return;
        }

        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          // Start with auto quality
          startLevel: -1,
          // ABR config
          abrEwmaDefaultEstimate: 500000, // 500kbps initial estimate
          abrBandWidthFactor: 0.95,
          abrBandWidthUpFactor: 0.7,
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
        });

        hls.loadSource(hlsMasterUrl);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setHlsActive(true);
          setCurrentQualityLabel('Auto');
          if (initialTime && initialTime > 0) {
            video.currentTime = initialTime;
            setCurrentTime(initialTime);
          }
        });

        // Track quality level changes for the UI label
        hls.on(Hls.Events.LEVEL_SWITCHED, (_: any, data: any) => {
          const level = hls.levels[data.level];
          if (level) {
            const h = level.height;
            const label = h >= 2160 ? '4K' : h >= 1080 ? '1080p' : h >= 720 ? '720p' : '480p';
            setCurrentQualityLabel(selectedQuality === 'auto' ? `Auto (${label})` : label);
          }
        });

        hls.on(Hls.Events.ERROR, (_: any, data: any) => {
          if (data.fatal) {
            console.error('[hls.js] Fatal error:', data.type, data.details);
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              hls.startLoad();
            } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              hls.recoverMediaError();
            } else {
              // Unrecoverable — fall back to direct MP4
              hls.destroy();
              setHlsActive(false);
              video.src = src;
            }
          }
        });

        hlsRef.current = hls;
      } catch (err) {
        console.warn('[VideoPlayer] Failed to load hls.js, falling back to direct playback:', err);
        setHlsActive(false);
      }
    })();

    return () => {
      destroyed = true;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [hlsMasterUrl]); // only re-run if the master URL changes

  // ── Dual-video quality switching ────────────────────────────────────────────
  // Two stacked <video> elements. The "active" one plays while the "standby"
  // one preloads the new quality in the background. Once ready, we swap them.
  const switchingRef   = useRef(false);
  const [activePlayer, setActivePlayer] = useState<'a' | 'b'>('a'); // which video is currently visible
  // Auto quality refs
  const autoQualityRef = useRef<string | null>(null);
  const stallCountRef  = useRef(0);
  const stableCountRef = useRef(0);

  /**
   * Seamlessly switch to a new MP4 URL using the dual-video technique.
   * The standby video loads + seeks in the background while the active one
   * keeps playing. Once ready, we swap visibility.
   */
  const dualVideoSwitch = useCallback((newUrl: string, label: string, onDone?: () => void) => {
    if (switchingRef.current) return;
    const active  = activePlayer === 'a' ? videoRef.current : videoRefB.current;
    const standby = activePlayer === 'a' ? videoRefB.current : videoRef.current;
    const nextPlayer = activePlayer === 'a' ? 'b' as const : 'a' as const;
    if (!active || !standby) return;

    switchingRef.current = true;

    const targetTime = active.currentTime;
    const wasPlaying = !active.paused;
    const vol = active.volume;
    const muted = active.muted;

    // Prepare standby
    standby.muted = true; // mute during preload to avoid double audio
    standby.preload = 'auto';
    standby.src = newUrl;
    standby.currentTime = targetTime;

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;

      // Sync time precisely right before swap
      standby.currentTime = active.currentTime;
      standby.volume = vol;
      standby.muted = muted;

      // Start playback on standby before swapping so there's no gap
      if (wasPlaying) {
        standby.play().catch(() => {});
      }

      // Swap: bring standby to front
      setActivePlayer(nextPlayer);

      // Pause the old active (now hidden) after a brief delay
      setTimeout(() => {
        active.pause();
        switchingRef.current = false;
        onDone?.();
      }, 150);
    };

    // Wait for standby to be ready
    const onCanPlay = () => { clearTimeout(timeout); finish(); };
    standby.addEventListener('canplay', onCanPlay, { once: true });

    // Timeout fallback
    const timeout = setTimeout(() => {
      standby.removeEventListener('canplay', onCanPlay);
      finish();
    }, 8000);

    standby.addEventListener('error', () => {
      clearTimeout(timeout);
      standby.removeEventListener('canplay', onCanPlay);
      switchingRef.current = false;
      // Fallback: hard swap on the active element
      active.src = newUrl;
      active.currentTime = targetTime;
      if (wasPlaying) active.play().catch(() => {});
      onDone?.();
    }, { once: true });
  }, [activePlayer]);

  // ── Auto quality (non-HLS): downgrade on stalls, upgrade when stable ───────
  useEffect(() => {
    if (selectedQuality !== 'auto' || hlsActive || !qualityVariants || qualityVariants.length < 2) return;

    const active = activePlayer === 'a' ? videoRef.current : videoRefB.current;
    if (!active) return;

    const sorted = [...qualityVariants].sort(
      (a, b) => (QUALITY_ORDER[b.quality] ?? 0) - (QUALITY_ORDER[a.quality] ?? 0),
    );

    // Initialize — the video already has src set from the prop (highest quality).
    // Just register which quality we're on without triggering a switch.
    if (!autoQualityRef.current) {
      // Figure out which variant matches the currently loaded src
      const currentSrc = active.currentSrc || active.src || '';
      const matchingVariant = sorted.find(v => currentSrc.includes(v.url.split('?')[0]));
      autoQualityRef.current = matchingVariant?.quality || sorted[0].quality;
      setCurrentQualityLabel(`Auto (${autoQualityRef.current})`);
    }

    const currentIdx = () => sorted.findIndex(v => v.quality === autoQualityRef.current);

    const onWaiting = () => {
      if (switchingRef.current) return;
      stallCountRef.current++;
      stableCountRef.current = 0;
      // After 2 stalls, downgrade
      if (stallCountRef.current >= 2) {
        const idx = currentIdx();
        if (idx < sorted.length - 1) {
          const nextQ = sorted[idx + 1].quality;
          console.log(`[auto-quality] Downgrading: ${autoQualityRef.current} → ${nextQ}`);
          autoQualityRef.current = nextQ;
          setCurrentQualityLabel(`Auto (${nextQ})`);
          dualVideoSwitch(sorted[idx + 1].url, nextQ);
          stallCountRef.current = 0;
        }
      }
    };

    // Every 10s of smooth playback, consider upgrading
    const stabilityCheck = setInterval(() => {
      if (active.paused || active.readyState < 3 || switchingRef.current) return;
      stableCountRef.current++;
      // After 30s of smooth playback (3 checks), try upgrading
      if (stableCountRef.current >= 3) {
        const idx = currentIdx();
        if (idx > 0) {
          const nextQ = sorted[idx - 1].quality;
          console.log(`[auto-quality] Upgrading: ${autoQualityRef.current} → ${nextQ}`);
          autoQualityRef.current = nextQ;
          setCurrentQualityLabel(`Auto (${nextQ})`);
          dualVideoSwitch(sorted[idx - 1].url, nextQ);
          stableCountRef.current = 0;
          stallCountRef.current = 0;
        }
      }
    }, 10_000);

    active.addEventListener('waiting', onWaiting);
    return () => {
      active.removeEventListener('waiting', onWaiting);
      clearInterval(stabilityCheck);
    };
  }, [selectedQuality, hlsActive, qualityVariants, dualVideoSwitch, activePlayer]);

  // ── Manual quality switching ───────────────────────────────────────────────
  const handleQualitySelect = useCallback((quality: string) => {
    setSelectedQuality(quality);
    setShowQualityMenu(false);

    if (hlsActive && hlsRef.current) {
      const hls = hlsRef.current;
      if (quality === 'auto') {
        hls.currentLevel = -1;
        setCurrentQualityLabel('Auto');
      } else {
        const levels = hls.levels || [];
        const targetHeight = quality === '4K' ? 2160 : quality === '1080p' ? 1080 : quality === '720p' ? 720 : 480;
        const idx = levels.findIndex((l: any) => l.height === targetHeight);
        if (idx >= 0) {
          hls.currentLevel = idx;
          setCurrentQualityLabel(quality);
        }
      }
    } else if (qualityVariants) {
      if (quality === 'auto') {
        // Reset auto state — start at highest
        stallCountRef.current = 0;
        stableCountRef.current = 0;
        const sorted = [...qualityVariants].sort(
          (a, b) => (QUALITY_ORDER[b.quality] ?? 0) - (QUALITY_ORDER[a.quality] ?? 0),
        );
        const best = sorted[0];
        if (best) {
          autoQualityRef.current = best.quality;
          setCurrentQualityLabel(`Auto (${best.quality})`);
          dualVideoSwitch(best.url, best.quality);
        }
      } else {
        autoQualityRef.current = null;
        setCurrentQualityLabel(quality);
        const variant = qualityVariants.find(v => v.quality === quality);
        if (variant) {
          dualVideoSwitch(variant.url, quality);
        }
      }
    }
  }, [hlsActive, qualityVariants, dualVideoSwitch]);

  // ── Seeking/seeked events ──────────────────────────────────────────────────
  useEffect(() => {
    const video = activePlayer === 'a' ? videoRef.current : videoRefB.current;
    if (!video) return;
    const onSeeking = () => { isSeeking.current = true; };
    const onSeeked  = () => {
      isSeeking.current = false;
      if (video) setCurrentTime(video.currentTime);
      seekTarget.current = null;
    };
    video.addEventListener('seeking', onSeeking);
    video.addEventListener('seeked',  onSeeked);
    return () => {
      video.removeEventListener('seeking', onSeeking);
      video.removeEventListener('seeked',  onSeeked);
    };
  }, [activePlayer]);

  useEffect(() => {
    const video = activePlayer === 'a' ? videoRef.current : videoRefB.current;
    if (!video) return;
    const sync = () => {
      const tracks = video?.textTracks;
      if (!tracks) return;
      for (let i = 0; i < tracks.length; i++)
        tracks[i].mode = tracks[i].language === activeSubtitle ? 'hidden' : 'disabled';
    };
    sync();
    const t = setTimeout(sync, 500);
    return () => clearTimeout(t);
  }, [activeSubtitle]);

  useEffect(() => {
    const video = activePlayer === 'a' ? videoRef.current : videoRefB.current;
    if (!video || !activeSubtitle) { setCurrentCue(null); return; }
    const update = () => {
      const tracks = video?.textTracks;
      if (!tracks) return;
      for (let i = 0; i < tracks.length; i++) {
        if (tracks[i].language === activeSubtitle && tracks[i].activeCues?.length) {
          setCurrentCue((tracks[i].activeCues![0] as VTTCue).text.replace(/<[^>]+>/g, ''));
          return;
        }
      }
      setCurrentCue(null);
    };
    const interval = setInterval(update, 100);
    return () => clearInterval(interval);
  }, [activeSubtitle, activePlayer]);

  // ── External control ───────────────────────────────────────────────────────
  useEffect(() => {
    const v = activePlayer === 'a' ? videoRef.current : videoRefB.current;
    if (!externalControl || !v) return;
    const fingerprint = `${externalControl.type}:${externalControl.timestamp.toFixed(2)}`;
    if (lastExternalControl.current === fingerprint) return;
    lastExternalControl.current = fingerprint;

    isExternalRef.current = true;
    seekTarget.current = externalControl.timestamp;
    isSeeking.current = true;

    switch (externalControl.type) {
      case 'play':
        v.currentTime = externalControl.timestamp;
        setCurrentTime(externalControl.timestamp);
        v.play().catch(() => {});
        setIsPlaying(true);
        break;
      case 'pause':
        v.currentTime = externalControl.timestamp;
        setCurrentTime(externalControl.timestamp);
        v.pause();
        setIsPlaying(false);
        break;
      case 'seek':
        v.currentTime = externalControl.timestamp;
        setCurrentTime(externalControl.timestamp);
        break;
    }
    setTimeout(() => { isExternalRef.current = false; }, 200);
  }, [externalControl, activePlayer]);

  // ── Waiting/buffering events (track on the active player) ─────────────────
  useEffect(() => {
    const video = activePlayer === 'a' ? videoRef.current : videoRefB.current;
    if (!video) return;
    const onWaiting = () => { if (!switchingRef.current) setIsWaiting(true); };
    const onPlaying = () => setIsWaiting(false);
    const onCanPlay = () => setIsWaiting(false);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('canplay', onCanPlay);
    return () => {
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('canplay', onCanPlay);
    };
  }, [activePlayer]);

  const emitEvent = useCallback((type: 'play' | 'pause' | 'seek', timestamp: number) => {
    if (!isExternalRef.current && onPlaybackEvent) onPlaybackEvent({ type, timestamp });
  }, [onPlaybackEvent]);

  const togglePlay = () => {
    const v = activePlayer === 'a' ? videoRef.current : videoRefB.current;
    if (!v) return;
    if (isPlaying) { v.pause(); setIsPlaying(false); emitEvent('pause', v.currentTime); }
    else { v.play().catch(() => {}); setIsPlaying(true); emitEvent('play', v.currentTime); }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    const v = activePlayer === 'a' ? videoRef.current : videoRefB.current;
    if (!progressRef.current || !v) return;
    const rect = progressRef.current.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const time = Math.max(0, Math.min(duration, ((clientX - rect.left) / rect.width) * duration));
    seekTarget.current = time;
    isSeeking.current = true;
    v.currentTime = time;
    setCurrentTime(time);
    emitEvent('seek', time);
  };

  const handleProgressMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressRef.current || !duration) return;
    const rect = progressRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    setHoverTime(pct * duration);
    setHoverX(x);
  };

  const skip = (s: number) => {
    const v = activePlayer === 'a' ? videoRef.current : videoRefB.current;
    if (!v) return;
    const t = Math.max(0, Math.min(duration, v.currentTime + s));
    seekTarget.current = t;
    isSeeking.current = true;
    v.currentTime = t;
    setCurrentTime(t);
    emitEvent('seek', t);
  };

  const toggleMute = () => {
    const v = activePlayer === 'a' ? videoRef.current : videoRefB.current;
    if (!v) return;
    v.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    const v = activePlayer === 'a' ? videoRef.current : videoRefB.current;
    if (v) { v.volume = val; v.muted = val === 0; }
    setVolume(val); setIsMuted(val === 0);
  };

  const toggleFullscreen = () => {
    const activeVideo = activePlayer === 'a' ? videoRef.current : videoRefB.current;
    const target = isMobile && activeVideo ? activeVideo : containerRef.current!;
    if (!getFullscreenElement()) { requestFullscreen(target); }
    else { exitFullscreen(); }
  };

  const showControlsTemporarily = () => {
    setShowControls(true);
    if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    if (isPlaying) hideTimeoutRef.current = setTimeout(() => setShowControls(false), 3000);
  };

  const handleTap = (e: React.TouchEvent<HTMLDivElement>) => {
    const now = Date.now();
    const timeSinceLast = now - lastTapRef.current;
    if (timeSinceLast < 300 && timeSinceLast > 0) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const x = e.changedTouches[0].clientX - rect.left;
      skip(x < rect.width / 2 ? -10 : 10);
    } else {
      showControlsTemporarily();
    }
    lastTapRef.current = now;
  };

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key) {
        case ' ': case 'k': e.preventDefault(); togglePlay(); break;
        case 'ArrowLeft':  skip(-10); break;
        case 'ArrowRight': skip(10);  break;
        case 'm': toggleMute(); break;
        case 'f': toggleFullscreen(); break;
        case 'q': // Cycle quality
          if (showQualitySelector && qualityVariants) {
            const qualities = ['auto', ...qualityVariants.map(v => v.quality).sort((a, b) => (QUALITY_ORDER[a] ?? 0) - (QUALITY_ORDER[b] ?? 0))];
            const idx = qualities.indexOf(selectedQuality);
            const next = qualities[(idx + 1) % qualities.length];
            handleQualitySelect(next);
          }
          break;
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isPlaying, duration, selectedQuality, showQualitySelector, qualityVariants, handleQualitySelect]);

  const handleTimeUpdate = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = e.currentTarget;
    if (!video) return;
    if (isSeeking.current) return;
    if (seekTarget.current !== null) {
      if (Math.abs(video.currentTime - seekTarget.current) > 1.5) return;
      seekTarget.current = null;
    }
    setCurrentTime(video.currentTime);
  }, []);

  const handleProgress = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = e.currentTarget;
    if (!video || !video.buffered.length) return;
    const ct = video.currentTime;
    let end = 0;
    for (let i = 0; i < video.buffered.length; i++) {
      if (video.buffered.start(i) <= ct && ct <= video.buffered.end(i)) {
        end = video.buffered.end(i);
        break;
      }
    }
    if (end === 0 && video.buffered.length > 0) {
      end = video.buffered.end(video.buffered.length - 1);
    }
    setBuffered(end);
  }, []);

  const subBottom = subStyle.position === 'bottom' ? (showControls ? '80px' : '20px') : undefined;
  const subTop    = subStyle.position === 'top' ? '20px' : undefined;

  // Build sorted quality list for the menu
  const qualityOptions = qualityVariants
    ? [...qualityVariants].sort((a, b) => (QUALITY_ORDER[b.quality] ?? 0) - (QUALITY_ORDER[a.quality] ?? 0))
    : [];

  return (
    <div
      ref={containerRef}
      className={cn('relative bg-black overflow-hidden select-none', className)}
      onMouseMove={showControlsTemporarily}
      onMouseLeave={() => isPlaying && setShowControls(false)}
      onTouchStart={handleTap}
      onClick={() => { setShowSubMenu(false); setShowSubSettings(false); setShowQualityMenu(false); }}
    >
      {/* Player A */}
      <video
        ref={videoRef}
        src={hlsActive ? undefined : src}
        className="absolute inset-0 w-full h-full object-contain transition-opacity duration-150"
        style={{ opacity: activePlayer === 'a' ? 1 : 0, zIndex: activePlayer === 'a' ? 2 : 1 }}
        onClick={isMobile ? undefined : (activePlayer === 'a' ? togglePlay : undefined)}
        preload="auto"
        playsInline
        onTimeUpdate={activePlayer === 'a' ? handleTimeUpdate : undefined}
        onLoadedMetadata={activePlayer === 'a' ? () => {
          if (videoRef.current) {
            setDuration(videoRef.current.duration);
            if (initialTime && initialTime > 0 && !hlsActive) {
              seekTarget.current = initialTime;
              isSeeking.current = true;
              videoRef.current.currentTime = initialTime;
              setCurrentTime(initialTime);
            }
          }
        } : undefined}
        onProgress={activePlayer === 'a' ? handleProgress : undefined}
        onEnded={activePlayer === 'a' ? () => setIsPlaying(false) : undefined}
        crossOrigin="anonymous"
      >
        {subtitles.map((t) => (
          <track key={t.lang} kind="subtitles" src={t.url} srcLang={t.lang} label={t.label} />
        ))}
      </video>

      {/* Player B (standby for seamless quality switching) */}
      <video
        ref={videoRefB}
        className="absolute inset-0 w-full h-full object-contain transition-opacity duration-150"
        style={{ opacity: activePlayer === 'b' ? 1 : 0, zIndex: activePlayer === 'b' ? 2 : 1 }}
        onClick={isMobile ? undefined : (activePlayer === 'b' ? togglePlay : undefined)}
        preload="none"
        playsInline
        onTimeUpdate={activePlayer === 'b' ? handleTimeUpdate : undefined}
        onLoadedMetadata={activePlayer === 'b' ? () => {
          if (videoRefB.current) {
            setDuration(videoRefB.current.duration);
          }
        } : undefined}
        onProgress={activePlayer === 'b' ? handleProgress : undefined}
        onEnded={activePlayer === 'b' ? () => setIsPlaying(false) : undefined}
        crossOrigin="anonymous"
      >
        {subtitles.map((t) => (
          <track key={`b-${t.lang}`} kind="subtitles" src={t.url} srcLang={t.lang} label={t.label} />
        ))}
      </video>

      {/* ── Buffering spinner ── */}
      {(isWaiting || preloader.isRecovering) && isPlaying && (
        <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
          <div className="w-12 h-12 rounded-full border-2 border-cinema-accent/30 border-t-cinema-accent animate-spin" />
        </div>
      )}

      {/* ── Subtitles ── */}
      {activeSubtitle && currentCue && (
        <div
          className="absolute left-1/2 -translate-x-1/2 z-20 text-center pointer-events-none transition-all duration-300 max-w-[85%]"
          style={{ bottom: subBottom, top: subTop }}
        >
          <span
            className="inline-block rounded-lg px-3 py-1 leading-snug whitespace-pre-line"
            style={{
              fontSize: `${subStyle.size}px`, color: COLOR_MAP[subStyle.color],
              opacity: subStyle.opacity, background: BG_MAP[subStyle.bg],
              textShadow: subStyle.bg === 'none' ? '0 1px 4px rgba(0,0,0,0.9)' : 'none',
              fontFamily: 'system-ui, sans-serif', fontWeight: 500,
            }}
          >{currentCue}</span>
        </div>
      )}

      {/* ── Center play button ── */}
      {!isPlaying && !isWaiting && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/20 cursor-pointer z-10" onClick={togglePlay}>
          <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-cinema-accent/90 flex items-center justify-center shadow-2xl">
            <Play className="w-6 h-6 sm:w-8 sm:h-8 text-cinema-bg ml-1" fill="currentColor" />
          </div>
        </div>
      )}

      {/* ── Controls overlay ── */}
      <div
        className={cn(
          'absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent transition-opacity duration-500 z-30',
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
        style={{ padding: '0 12px 12px' }}
      >
        {/* Progress bar */}
        <div
          ref={progressRef}
          className="relative cursor-pointer mb-3 group/progress"
          style={{ height: isMobile ? '20px' : '12px', display: 'flex', alignItems: 'center' }}
          onClick={handleSeek}
          onTouchStart={handleSeek}
          onMouseMove={handleProgressMouseMove}
          onMouseLeave={() => setHoverTime(null)}
        >
          {hoverTime !== null && (
            <div
              className="absolute -top-8 pointer-events-none z-50"
              style={{ left: hoverX, transform: 'translateX(-50%)' }}
            >
              <span className="bg-black/80 text-white text-xs font-mono px-1.5 py-0.5 rounded whitespace-nowrap">
                {formatDuration(hoverTime)}
              </span>
            </div>
          )}

          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 bg-white/20 rounded-full overflow-hidden">
            <div className="absolute inset-y-0 left-0 bg-white/25 rounded-full" style={{ width: `${duration ? (buffered / duration) * 100 : 0}%` }} />
            <div className="absolute inset-y-0 left-0 bg-cinema-accent rounded-full" style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}>
              <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-cinema-accent shadow-lg" />
            </div>
          </div>
        </div>

        {/* Controls row */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <button onClick={() => skip(-10)} className="text-white/70 hover:text-white transition-colors p-1">
              <SkipBack className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
            <button onClick={togglePlay} className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-cinema-accent flex items-center justify-center flex-shrink-0">
              {isPlaying
                ? <Pause className="w-4 h-4 sm:w-5 sm:h-5 text-cinema-bg" fill="currentColor" />
                : <Play  className="w-4 h-4 sm:w-5 sm:h-5 text-cinema-bg ml-0.5" fill="currentColor" />}
            </button>
            <button onClick={() => skip(10)} className="text-white/70 hover:text-white transition-colors p-1">
              <SkipForward className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>

            {!isMobile && (
              <div className="flex items-center gap-2 ml-1">
                <button onClick={toggleMute} className="text-white/70 hover:text-white transition-colors">
                  {isMuted || volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                </button>
                <input type="range" min="0" max="1" step="0.05" value={isMuted ? 0 : volume} onChange={handleVolumeChange} className="w-20 accent-cinema-accent" />
              </div>
            )}

            <span className="text-xs sm:text-sm text-white/70 font-mono ml-1 whitespace-nowrap">
              {formatDuration(currentTime)}<span className="hidden sm:inline"> / {formatDuration(duration)}</span>
            </span>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">

            {/* ── Quality selector ── */}
            {showQualitySelector && (
              <div className="relative">
                <button
                  onClick={(e) => { e.stopPropagation(); setShowQualityMenu(v => !v); setShowSubMenu(false); setShowSubSettings(false); }}
                  className={cn(
                    'flex items-center gap-1 px-2 py-1 rounded-lg transition-colors text-xs sm:text-sm',
                    showQualityMenu ? 'text-cinema-accent bg-cinema-accent/10' : 'text-white/70 hover:text-white',
                  )}
                >
                  <Gauge className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  {currentQualityLabel && (
                    <span className="text-xs font-medium hidden sm:inline">{currentQualityLabel}</span>
                  )}
                </button>

                {showQualityMenu && (
                  <div
                    className="absolute bottom-10 right-0 bg-cinema-card border border-cinema-border rounded-xl shadow-2xl py-1 min-w-[140px] z-50"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <p className="text-[10px] text-cinema-text-dim px-3 pt-1 pb-1.5 uppercase tracking-wider">Quality</p>

                    {/* Auto option — shown when HLS or 2+ quality variants */}
                    {(hasHls || hasVariants) && (
                      <button
                        onClick={() => handleQualitySelect('auto')}
                        className={cn(
                          'w-full text-left px-4 py-2 text-sm hover:bg-cinema-surface flex items-center justify-between',
                          selectedQuality === 'auto' ? 'text-cinema-accent font-medium' : 'text-cinema-text',
                        )}
                      >
                        <span>Auto</span>
                        {selectedQuality === 'auto' && currentQualityLabel && (
                          <span className="text-[10px] text-cinema-text-dim ml-2">
                            {currentQualityLabel.replace('Auto ', '').replace(/[()]/g, '')}
                          </span>
                        )}
                      </button>
                    )}

                    {/* Individual quality options */}
                    {qualityOptions.map((v) => (
                      <button
                        key={v.quality}
                        onClick={() => handleQualitySelect(v.quality)}
                        className={cn(
                          'w-full text-left px-4 py-2 text-sm hover:bg-cinema-surface',
                          selectedQuality === v.quality ? 'text-cinema-accent font-medium' : 'text-cinema-text',
                        )}
                      >
                        {v.quality}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Subtitle selector ── */}
            {subtitles.length > 0 && (
              <div className="relative">
                <button
                  onClick={(e) => { e.stopPropagation(); setShowSubMenu(v => !v); setShowSubSettings(false); setShowQualityMenu(false); }}
                  className={cn('flex items-center gap-1 px-2 py-1 rounded-lg transition-colors text-xs sm:text-sm', activeSubtitle ? 'text-cinema-accent bg-cinema-accent/10' : 'text-white/70 hover:text-white')}
                >
                  <Subtitles className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  {activeSubtitle && <span className="text-xs font-medium uppercase hidden sm:inline">{activeSubtitle}</span>}
                </button>
                {showSubMenu && (
                  <div className="absolute bottom-10 right-0 bg-cinema-card border border-cinema-border rounded-xl shadow-2xl py-1 min-w-[130px] z-50" onClick={(e) => e.stopPropagation()}>
                    <p className="text-[10px] text-cinema-text-dim px-3 pt-1 pb-1.5 uppercase tracking-wider">Language</p>
                    <button onClick={() => { setActiveSubtitle(null); setShowSubMenu(false); }} className={cn('w-full text-left px-4 py-2 text-sm hover:bg-cinema-surface', !activeSubtitle ? 'text-cinema-accent font-medium' : 'text-cinema-text')}>Off</button>
                    {subtitles.map((track) => (
                      <button key={track.lang} onClick={() => { setActiveSubtitle(track.lang); setShowSubMenu(false); }} className={cn('w-full text-left px-4 py-2 text-sm hover:bg-cinema-surface', activeSubtitle === track.lang ? 'text-cinema-accent font-medium' : 'text-cinema-text')}>{track.label}</button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Subtitle settings ── */}
            {subtitles.length > 0 && activeSubtitle && !isMobile && (
              <div className="relative">
                <button
                  onClick={(e) => { e.stopPropagation(); setShowSubSettings(v => !v); setShowSubMenu(false); setShowQualityMenu(false); }}
                  className={cn('p-1.5 rounded-lg transition-colors', showSubSettings ? 'text-cinema-accent bg-cinema-accent/10' : 'text-white/70 hover:text-white')}
                >
                  <Settings2 className="w-4 h-4" />
                </button>
                {showSubSettings && (
                  <div className="absolute bottom-10 right-0 bg-cinema-card border border-cinema-border rounded-2xl shadow-2xl p-4 w-60 z-50 space-y-4" onClick={(e) => e.stopPropagation()}>
                    <p className="text-xs font-semibold text-cinema-text uppercase tracking-wider">Subtitle Style</p>
                    <div className="space-y-1.5">
                      <div className="flex justify-between"><span className="text-xs text-cinema-text-muted">Size</span><span className="text-xs text-cinema-accent font-mono">{subStyle.size}px</span></div>
                      <input type="range" min="18" max="42" step="2" value={subStyle.size} onChange={(e) => updateSubStyle(s => ({ ...s, size: +e.target.value }))} className="w-full accent-cinema-accent h-1.5" />
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex justify-between"><span className="text-xs text-cinema-text-muted">Opacity</span><span className="text-xs text-cinema-accent font-mono">{Math.round(subStyle.opacity * 100)}%</span></div>
                      <input type="range" min="0.2" max="1" step="0.05" value={subStyle.opacity} onChange={(e) => updateSubStyle(s => ({ ...s, opacity: +e.target.value }))} className="w-full accent-cinema-accent h-1.5" />
                    </div>
                    <div className="space-y-1.5">
                      <span className="text-xs text-cinema-text-muted">Color</span>
                      <div className="flex gap-2 mt-1">
                        {(['white','yellow','cyan'] as const).map((c) => (
                          <button key={c} onClick={() => updateSubStyle(s => ({ ...s, color: c }))} className={cn('flex-1 py-1.5 rounded-lg text-xs font-medium border transition-all', subStyle.color === c ? 'border-cinema-accent scale-105' : 'border-cinema-border')} style={{ color: COLOR_MAP[c], background: 'rgba(255,255,255,0.05)' }}>{c.charAt(0).toUpperCase()+c.slice(1)}</button>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <span className="text-xs text-cinema-text-muted">Background</span>
                      <div className="flex gap-2 mt-1">
                        {(['black','dark','none'] as const).map((b) => (
                          <button key={b} onClick={() => updateSubStyle(s => ({ ...s, bg: b }))} className={cn('flex-1 py-1.5 rounded-lg text-xs font-medium border transition-all text-white', subStyle.bg === b ? 'border-cinema-accent scale-105' : 'border-cinema-border')} style={{ background: b === 'black' ? 'rgba(0,0,0,0.85)' : b === 'dark' ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.08)' }}>{b === 'black' ? 'Solid' : b === 'dark' ? 'Semi' : 'None'}</button>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <span className="text-xs text-cinema-text-muted">Position</span>
                      <div className="flex gap-2 mt-1">
                        {(['bottom','top'] as const).map((p) => (
                          <button key={p} onClick={() => updateSubStyle(s => ({ ...s, position: p }))} className={cn('flex-1 py-1.5 rounded-lg text-xs font-medium border transition-all text-cinema-text', subStyle.position === p ? 'border-cinema-accent bg-cinema-accent/10 text-cinema-accent' : 'border-cinema-border bg-white/5')}>{p === 'bottom' ? '↓ Bottom' : '↑ Top'}</button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            <button onClick={toggleFullscreen} className="text-white/70 hover:text-white transition-colors p-1">
              {isFullscreen ? <Minimize className="w-4 h-4 sm:w-5 sm:h-5" /> : <Maximize className="w-4 h-4 sm:w-5 sm:h-5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}