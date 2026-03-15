'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize, SkipBack, SkipForward, Subtitles, Settings2 } from 'lucide-react';
import { formatDuration } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { useVideoPreloader } from '@/hooks/useVideoPreloader';

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

interface SubtitleTrack { label: string; lang: string; url: string; }
interface SubtitleStyle {
  size: number; opacity: number; bg: 'black' | 'dark' | 'none';
  position: 'bottom' | 'top'; color: 'white' | 'yellow' | 'cyan';
}
interface VideoPlayerProps {
  src: string;
  subtitles?: SubtitleTrack[];
  initialTime?: number;
  onPlaybackEvent?: (event: { type: 'play' | 'pause' | 'seek'; timestamp: number }) => void;
  externalControl?: { type: 'play' | 'pause' | 'seek'; timestamp: number } | null;
  className?: string;
}

const BG_MAP    = { black: 'rgba(0,0,0,0.85)', dark: 'rgba(0,0,0,0.45)', none: 'transparent' };
const COLOR_MAP = { white: '#ffffff', yellow: '#fde68a', cyan: '#a5f3fc' };


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

export default function VideoPlayer({ src, subtitles = [], initialTime, onPlaybackEvent, externalControl, className }: VideoPlayerProps) {
  const videoRef       = useRef<HTMLVideoElement>(null);
  const containerRef   = useRef<HTMLDivElement>(null);
  const progressRef    = useRef<HTMLDivElement>(null);
  const hideTimeoutRef = useRef<NodeJS.Timeout>();
  const isExternalRef  = useRef(false);
  const lastTapRef     = useRef<number>(0);
<<<<<<< HEAD
  const isDraggingRef  = useRef(false);
  const isMobileRef    = useRef(false);
=======
>>>>>>> parent of 4061064 (video player fixed + time on hover)

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

  const [activeSubtitle,   setActiveSubtitle]   = useState<string | null>(subtitles.length > 0 ? subtitles[0].lang : null);
  const [currentCue,       setCurrentCue]       = useState<string | null>(null);
  const [showSubMenu,      setShowSubMenu]      = useState(false);
  const [showSubSettings,  setShowSubSettings]  = useState(false);
  const [subStyle, setSubStyle] = useState<SubtitleStyle>(DEFAULT_SUB_STYLE);

  // Load saved subtitle prefs from cookie on mount
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
<<<<<<< HEAD

  // Detect mobile early via ref so preloader reads correct value on first render
=======
  const preloader = useVideoPreloader({ videoRef, src, enabled: true });

>>>>>>> parent of 4061064 (video player fixed + time on hover)
  useEffect(() => {
    const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    isMobileRef.current = mobile;
    setIsMobile(mobile);
  }, []);

  const preloader = useVideoPreloader({ videoRef, src, enabled: !isMobileRef.current });

  useEffect(() => {
    const update = () => setIsFullscreen(!!getFullscreenElement());
    document.addEventListener('fullscreenchange', update);
    document.addEventListener('webkitfullscreenchange', update);
    return () => {
      document.removeEventListener('fullscreenchange', update);
      document.removeEventListener('webkitfullscreenchange', update);
    };
  }, []);

  useEffect(() => {
    if (!videoRef.current) return;
    const sync = () => {
      const tracks = videoRef.current?.textTracks;
      if (!tracks) return;
      for (let i = 0; i < tracks.length; i++)
        tracks[i].mode = tracks[i].language === activeSubtitle ? 'hidden' : 'disabled';
    };
    sync();
    const t = setTimeout(sync, 500);
    return () => clearTimeout(t);
  }, [activeSubtitle]);

  useEffect(() => {
    if (!videoRef.current || !activeSubtitle) { setCurrentCue(null); return; }
    const update = () => {
      const tracks = videoRef.current?.textTracks;
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
  }, [activeSubtitle]);

  useEffect(() => {
    if (!externalControl || !videoRef.current) return;
    isExternalRef.current = true;
    const v = videoRef.current;
    switch (externalControl.type) {
      case 'play':  v.currentTime = externalControl.timestamp; v.play().catch(() => {}); setIsPlaying(true);  break;
      case 'pause': v.currentTime = externalControl.timestamp; v.pause(); setIsPlaying(false); break;
      case 'seek':  v.currentTime = externalControl.timestamp; break;
    }
    setTimeout(() => { isExternalRef.current = false; }, 100);
  }, [externalControl]);

  // ── Stall/waiting state ──────────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onWaiting = () => setIsWaiting(true);
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
  }, []);

  const emitEvent = useCallback((type: 'play' | 'pause' | 'seek', timestamp: number) => {
    if (!isExternalRef.current && onPlaybackEvent) onPlaybackEvent({ type, timestamp });
  }, [onPlaybackEvent]);

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) { videoRef.current.pause(); setIsPlaying(false); emitEvent('pause', videoRef.current.currentTime); }
    else { videoRef.current.play().catch(() => {}); setIsPlaying(true); emitEvent('play', videoRef.current.currentTime); }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    if (!progressRef.current || !videoRef.current) return;
    const rect = progressRef.current.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const time = Math.max(0, Math.min(duration, ((clientX - rect.left) / rect.width) * duration));
    videoRef.current.currentTime = time;
    setCurrentTime(time);
    emitEvent('seek', time);
  };

  const skip = (s: number) => {
    if (!videoRef.current) return;
    const t = Math.max(0, Math.min(duration, videoRef.current.currentTime + s));
    videoRef.current.currentTime = t;
    emitEvent('seek', t);
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    videoRef.current.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (videoRef.current) { videoRef.current.volume = val; videoRef.current.muted = val === 0; }
    setVolume(val); setIsMuted(val === 0);
  };

  const toggleFullscreen = () => {
    const target = isMobile && videoRef.current ? videoRef.current : containerRef.current!;
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
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isPlaying, duration]);

  const subBottom = subStyle.position === 'bottom' ? (showControls ? '80px' : '20px') : undefined;
  const subTop    = subStyle.position === 'top' ? '20px' : undefined;


  return (
    <div
      ref={containerRef}
      className={cn('relative bg-black overflow-hidden select-none', className)}
      onMouseMove={showControlsTemporarily}
      onMouseLeave={() => isPlaying && setShowControls(false)}
      onTouchStart={handleTap}
      onClick={() => { setShowSubMenu(false); setShowSubSettings(false); }}
    >
      <video
        ref={videoRef}
        src={src}
        className="w-full h-full object-contain"
        onClick={isMobile ? undefined : togglePlay}
        preload="auto"
<<<<<<< HEAD
        playsInline
=======
>>>>>>> parent of 4061064 (video player fixed + time on hover)
        onTimeUpdate={() => { if (videoRef.current) setCurrentTime(videoRef.current.currentTime); }}
        onLoadedMetadata={() => {
          if (videoRef.current) {
            setDuration(videoRef.current.duration);
            if (initialTime && initialTime > 0) { videoRef.current.currentTime = initialTime; setCurrentTime(initialTime); }
          }
        }}
        onProgress={() => {
          if (videoRef.current?.buffered.length)
            setBuffered(videoRef.current.buffered.end(videoRef.current.buffered.length - 1));
        }}
        onEnded={() => setIsPlaying(false)}
        playsInline
        crossOrigin="anonymous"
      >
        {subtitles.map((t) => (
          <track key={t.lang} kind="subtitles" src={t.url} srcLang={t.lang} label={t.label} />
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
        {/* Progress bar — multi-range buffered segments */}
        <div
          ref={progressRef}
          className="relative cursor-pointer mb-3 group/progress"
          style={{ height: isMobile ? '20px' : '12px', display: 'flex', alignItems: 'center' }}
          onClick={handleSeek}
          onTouchStart={handleSeek}
        >
          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 bg-white/20 rounded-full overflow-hidden">
            {/* Single buffered bar */}
            <div className="absolute inset-y-0 left-0 bg-white/25 rounded-full" style={{ width: `${duration ? (buffered / duration) * 100 : 0}%` }} />
            {/* Playhead */}
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


            {subtitles.length > 0 && (
              <div className="relative">
                <button
                  onClick={(e) => { e.stopPropagation(); setShowSubMenu(v => !v); setShowSubSettings(false); }}
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

            {subtitles.length > 0 && activeSubtitle && !isMobile && (
              <div className="relative">
                <button
                  onClick={(e) => { e.stopPropagation(); setShowSubSettings(v => !v); setShowSubMenu(false); }}
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