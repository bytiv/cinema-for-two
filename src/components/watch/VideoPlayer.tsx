'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize, SkipBack, SkipForward, Subtitles, Settings2, ChevronUp, ChevronDown } from 'lucide-react';
import { formatDuration } from '@/lib/utils';
import { cn } from '@/lib/utils';

interface SubtitleTrack { label: string; lang: string; url: string; }

interface SubtitleStyle {
  size: number;        // 12–32px
  opacity: number;     // 0.1–1
  bg: 'black' | 'dark' | 'none';
  position: 'bottom' | 'top';
  color: 'white' | 'yellow' | 'cyan';
}

interface VideoPlayerProps {
  src: string;
  subtitles?: SubtitleTrack[];
  initialTime?: number;
  onPlaybackEvent?: (event: { type: 'play' | 'pause' | 'seek'; timestamp: number }) => void;
  externalControl?: { type: 'play' | 'pause' | 'seek'; timestamp: number } | null;
  className?: string;
}

const BG_MAP = {
  black: 'rgba(0,0,0,0.85)',
  dark:  'rgba(0,0,0,0.45)',
  none:  'transparent',
};

const COLOR_MAP = {
  white:  '#ffffff',
  yellow: '#fde68a',
  cyan:   '#a5f3fc',
};

export default function VideoPlayer({ src, subtitles = [], initialTime, onPlaybackEvent, externalControl, className }: VideoPlayerProps) {
  const videoRef      = useRef<HTMLVideoElement>(null);
  const containerRef  = useRef<HTMLDivElement>(null);
  const progressRef   = useRef<HTMLDivElement>(null);
  const hideTimeoutRef = useRef<NodeJS.Timeout>();
  const isExternalRef  = useRef(false);

  const [isPlaying,    setIsPlaying]    = useState(false);
  const [currentTime,  setCurrentTime]  = useState(0);
  const [duration,     setDuration]     = useState(0);
  const [volume,       setVolume]       = useState(1);
  const [isMuted,      setIsMuted]      = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [buffered,     setBuffered]     = useState(0);

  // Subtitle state
  const [activeSubtitle, setActiveSubtitle] = useState<string | null>(
    subtitles.length > 0 ? subtitles[0].lang : null
  );
  const [currentCue,   setCurrentCue]   = useState<string | null>(null);
  const [showSubMenu,  setShowSubMenu]  = useState(false);
  const [showSubSettings, setShowSubSettings] = useState(false);
  const [subStyle, setSubStyle] = useState<SubtitleStyle>({
    size: 20, opacity: 1, bg: 'dark', position: 'bottom', color: 'white',
  });

  // ── Disable native captions, drive cues manually ──────────
  useEffect(() => {
    if (!videoRef.current) return;
    const sync = () => {
      const tracks = videoRef.current?.textTracks;
      if (!tracks) return;
      for (let i = 0; i < tracks.length; i++) {
        // 'hidden' keeps cues firing but hides native rendering
        tracks[i].mode = tracks[i].language === activeSubtitle ? 'hidden' : 'disabled';
      }
    };
    sync();
    const t = setTimeout(sync, 500);
    return () => clearTimeout(t);
  }, [activeSubtitle]);

  // ── Poll active cue text ───────────────────────────────────
  useEffect(() => {
    if (!videoRef.current || !activeSubtitle) { setCurrentCue(null); return; }
    const update = () => {
      const tracks = videoRef.current?.textTracks;
      if (!tracks) return;
      for (let i = 0; i < tracks.length; i++) {
        if (tracks[i].language === activeSubtitle && tracks[i].activeCues && tracks[i].activeCues!.length > 0) {
          const cue = tracks[i].activeCues![0] as VTTCue;
          setCurrentCue(cue.text.replace(/<[^>]+>/g, ''));
          return;
        }
      }
      setCurrentCue(null);
    };
    const interval = setInterval(update, 100);
    return () => clearInterval(interval);
  }, [activeSubtitle]);

  // ── External sync ─────────────────────────────────────────
  useEffect(() => {
    if (!externalControl || !videoRef.current) return;
    isExternalRef.current = true;
    const video = videoRef.current;
    switch (externalControl.type) {
      case 'play':  video.currentTime = externalControl.timestamp; video.play().catch(() => {}); setIsPlaying(true);  break;
      case 'pause': video.currentTime = externalControl.timestamp; video.pause(); setIsPlaying(false); break;
      case 'seek':  video.currentTime = externalControl.timestamp; break;
    }
    setTimeout(() => { isExternalRef.current = false; }, 100);
  }, [externalControl]);

  const emitEvent = useCallback((type: 'play' | 'pause' | 'seek', timestamp: number) => {
    if (!isExternalRef.current && onPlaybackEvent) onPlaybackEvent({ type, timestamp });
  }, [onPlaybackEvent]);

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) { videoRef.current.pause(); setIsPlaying(false); emitEvent('pause', videoRef.current.currentTime); }
    else           { videoRef.current.play().catch(() => {}); setIsPlaying(true); emitEvent('play', videoRef.current.currentTime); }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressRef.current || !videoRef.current) return;
    const rect = progressRef.current.getBoundingClientRect();
    const time = ((e.clientX - rect.left) / rect.width) * duration;
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
    if (!containerRef.current) return;
    if (!document.fullscreenElement) { containerRef.current.requestFullscreen(); setIsFullscreen(true); }
    else { document.exitFullscreen(); setIsFullscreen(false); }
  };

  const handleMouseMove = () => {
    setShowControls(true);
    if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    if (isPlaying) hideTimeoutRef.current = setTimeout(() => setShowControls(false), 3000);
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

  // How far up the subtitle sits — moves up when controls are visible
  const subBottom = subStyle.position === 'bottom'
    ? (showControls ? '90px' : '24px')
    : undefined;
  const subTop = subStyle.position === 'top' ? '24px' : undefined;

  return (
    <div
      ref={containerRef}
      className={cn('relative bg-black rounded-2xl overflow-hidden group select-none', className)}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => isPlaying && setShowControls(false)}
      onClick={() => { setShowSubMenu(false); setShowSubSettings(false); }}
    >
      <video
        ref={videoRef}
        src={src}
        className="w-full h-full object-contain cursor-pointer"
        onClick={togglePlay}
        onTimeUpdate={() => { if (videoRef.current) setCurrentTime(videoRef.current.currentTime); }}
        onLoadedMetadata={() => {
          if (videoRef.current) {
            setDuration(videoRef.current.duration);
            if (initialTime && initialTime > 0) { videoRef.current.currentTime = initialTime; setCurrentTime(initialTime); }
          }
        }}
        onProgress={() => {
          if (videoRef.current && videoRef.current.buffered.length > 0)
            setBuffered(videoRef.current.buffered.end(videoRef.current.buffered.length - 1));
        }}
        onEnded={() => setIsPlaying(false)}
        playsInline
        crossOrigin="anonymous"
      >
        {subtitles.map((track) => (
          <track key={track.lang} kind="subtitles" src={track.url} srcLang={track.lang} label={track.label} />
        ))}
      </video>

      {/* ── Custom subtitle renderer ── */}
      {activeSubtitle && currentCue && (
        <div
          className="absolute left-1/2 -translate-x-1/2 z-20 text-center pointer-events-none transition-all duration-300 max-w-[80%]"
          style={{ bottom: subBottom, top: subTop }}
        >
          <span
            className="inline-block rounded-lg px-3 py-1 leading-snug whitespace-pre-line"
            style={{
              fontSize: `${subStyle.size}px`,
              color: COLOR_MAP[subStyle.color],
              opacity: subStyle.opacity,
              background: BG_MAP[subStyle.bg],
              textShadow: subStyle.bg === 'none' ? '0 1px 4px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.7)' : 'none',
              fontFamily: 'system-ui, sans-serif',
              fontWeight: 500,
            }}
          >
            {currentCue}
          </span>
        </div>
      )}

      {/* ── Center play button ── */}
      {!isPlaying && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/20 cursor-pointer z-10" onClick={togglePlay}>
          <div className="w-20 h-20 rounded-full bg-cinema-accent/90 flex items-center justify-center shadow-2xl animate-pulse-glow">
            <Play className="w-8 h-8 text-cinema-bg ml-1" fill="currentColor" />
          </div>
        </div>
      )}

      {/* ── Controls overlay ── */}
      <div
        className={cn(
          'absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent p-4 pt-12 transition-opacity duration-500 z-30',
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
      >
        {/* Progress bar */}
        <div
          ref={progressRef}
          className="relative h-1.5 bg-white/20 rounded-full cursor-pointer mb-4 group/progress hover:h-2.5 transition-all"
          onClick={handleSeek}
        >
          <div className="absolute inset-y-0 left-0 bg-white/20 rounded-full" style={{ width: `${duration ? (buffered/duration)*100 : 0}%` }} />
          <div className="absolute inset-y-0 left-0 bg-cinema-accent rounded-full" style={{ width: `${duration ? (currentTime/duration)*100 : 0}%` }}>
            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-cinema-accent shadow-lg opacity-0 group-hover/progress:opacity-100 transition-opacity" />
          </div>
        </div>

        {/* Controls row */}
        <div className="flex items-center justify-between">
          {/* Left controls */}
          <div className="flex items-center gap-3">
            <button onClick={() => skip(-10)} className="text-white/70 hover:text-white transition-colors"><SkipBack className="w-5 h-5" /></button>
            <button onClick={togglePlay} className="w-10 h-10 rounded-full bg-cinema-accent flex items-center justify-center hover:bg-cinema-accent-light transition-colors">
              {isPlaying ? <Pause className="w-5 h-5 text-cinema-bg" fill="currentColor" /> : <Play className="w-5 h-5 text-cinema-bg ml-0.5" fill="currentColor" />}
            </button>
            <button onClick={() => skip(10)} className="text-white/70 hover:text-white transition-colors"><SkipForward className="w-5 h-5" /></button>

            <div className="flex items-center gap-2 ml-2">
              <button onClick={toggleMute} className="text-white/70 hover:text-white transition-colors">
                {isMuted || volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
              </button>
              <input type="range" min="0" max="1" step="0.05" value={isMuted ? 0 : volume} onChange={handleVolumeChange} className="w-20 accent-cinema-accent" />
            </div>

            <span className="text-sm text-white/70 font-mono ml-2">{formatDuration(currentTime)} / {formatDuration(duration)}</span>
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-2">

            {/* Subtitle language picker */}
            {subtitles.length > 0 && (
              <div className="relative">
                <button
                  onClick={(e) => { e.stopPropagation(); setShowSubMenu(v => !v); setShowSubSettings(false); }}
                  className={cn('flex items-center gap-1.5 text-sm px-2.5 py-1 rounded-lg transition-colors', activeSubtitle ? 'text-cinema-accent bg-cinema-accent/10' : 'text-white/70 hover:text-white')}
                >
                  <Subtitles className="w-4 h-4" />
                  {activeSubtitle && <span className="text-xs font-medium uppercase">{activeSubtitle}</span>}
                </button>

                {showSubMenu && (
                  <div
                    className="absolute bottom-10 right-0 bg-cinema-card border border-cinema-border rounded-xl shadow-2xl py-1 min-w-[140px] z-50"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <p className="text-[10px] text-cinema-text-dim px-3 pt-1 pb-1.5 uppercase tracking-wider">Language</p>
                    <button
                      onClick={() => { setActiveSubtitle(null); setShowSubMenu(false); }}
                      className={cn('w-full text-left px-4 py-2 text-sm transition-colors hover:bg-cinema-surface', !activeSubtitle ? 'text-cinema-accent font-medium' : 'text-cinema-text')}
                    >Off</button>
                    {subtitles.map((track) => (
                      <button
                        key={track.lang}
                        onClick={() => { setActiveSubtitle(track.lang); setShowSubMenu(false); }}
                        className={cn('w-full text-left px-4 py-2 text-sm transition-colors hover:bg-cinema-surface', activeSubtitle === track.lang ? 'text-cinema-accent font-medium' : 'text-cinema-text')}
                      >{track.label}</button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Subtitle style settings — only when subs are active */}
            {subtitles.length > 0 && activeSubtitle && (
              <div className="relative">
                <button
                  onClick={(e) => { e.stopPropagation(); setShowSubSettings(v => !v); setShowSubMenu(false); }}
                  className={cn('p-1.5 rounded-lg transition-colors', showSubSettings ? 'text-cinema-accent bg-cinema-accent/10' : 'text-white/70 hover:text-white')}
                  title="Subtitle style"
                >
                  <Settings2 className="w-4 h-4" />
                </button>

                {showSubSettings && (
                  <div
                    className="absolute bottom-10 right-0 bg-cinema-card border border-cinema-border rounded-2xl shadow-2xl p-4 w-64 z-50 space-y-4"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <p className="text-xs font-semibold text-cinema-text uppercase tracking-wider">Subtitle Style</p>

                    {/* Size */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-cinema-text-muted">Size</span>
                        <span className="text-xs text-cinema-accent font-mono">{subStyle.size}px</span>
                      </div>
                      <input
                        type="range" min="12" max="36" step="2"
                        value={subStyle.size}
                        onChange={(e) => setSubStyle(s => ({ ...s, size: +e.target.value }))}
                        className="w-full accent-cinema-accent h-1.5"
                      />
                    </div>

                    {/* Opacity */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-cinema-text-muted">Opacity</span>
                        <span className="text-xs text-cinema-accent font-mono">{Math.round(subStyle.opacity * 100)}%</span>
                      </div>
                      <input
                        type="range" min="0.2" max="1" step="0.05"
                        value={subStyle.opacity}
                        onChange={(e) => setSubStyle(s => ({ ...s, opacity: +e.target.value }))}
                        className="w-full accent-cinema-accent h-1.5"
                      />
                    </div>

                    {/* Color */}
                    <div className="space-y-1.5">
                      <span className="text-xs text-cinema-text-muted">Color</span>
                      <div className="flex gap-2 mt-1">
                        {(['white', 'yellow', 'cyan'] as const).map((c) => (
                          <button
                            key={c}
                            onClick={() => setSubStyle(s => ({ ...s, color: c }))}
                            className={cn('flex-1 py-1.5 rounded-lg text-xs font-medium border transition-all', subStyle.color === c ? 'border-cinema-accent scale-105' : 'border-cinema-border hover:border-cinema-border/80')}
                            style={{ color: COLOR_MAP[c], background: 'rgba(255,255,255,0.05)' }}
                          >
                            {c.charAt(0).toUpperCase() + c.slice(1)}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Background */}
                    <div className="space-y-1.5">
                      <span className="text-xs text-cinema-text-muted">Background</span>
                      <div className="flex gap-2 mt-1">
                        {(['black', 'dark', 'none'] as const).map((b) => (
                          <button
                            key={b}
                            onClick={() => setSubStyle(s => ({ ...s, bg: b }))}
                            className={cn('flex-1 py-1.5 rounded-lg text-xs font-medium border transition-all text-white', subStyle.bg === b ? 'border-cinema-accent scale-105' : 'border-cinema-border hover:border-cinema-border/80')}
                            style={{ background: b === 'black' ? 'rgba(0,0,0,0.85)' : b === 'dark' ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.08)' }}
                          >
                            {b === 'black' ? 'Solid' : b === 'dark' ? 'Semi' : 'None'}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Position */}
                    <div className="space-y-1.5">
                      <span className="text-xs text-cinema-text-muted">Position</span>
                      <div className="flex gap-2 mt-1">
                        {(['bottom', 'top'] as const).map((p) => (
                          <button
                            key={p}
                            onClick={() => setSubStyle(s => ({ ...s, position: p }))}
                            className={cn('flex-1 py-1.5 rounded-lg text-xs font-medium border transition-all text-cinema-text', subStyle.position === p ? 'border-cinema-accent bg-cinema-accent/10 text-cinema-accent' : 'border-cinema-border hover:border-cinema-border/80 bg-white/5')}
                          >
                            {p === 'bottom' ? '↓ Bottom' : '↑ Top'}
                          </button>
                        ))}
                      </div>
                    </div>

                  </div>
                )}
              </div>
            )}

            <button onClick={toggleFullscreen} className="text-white/70 hover:text-white transition-colors">
              {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}