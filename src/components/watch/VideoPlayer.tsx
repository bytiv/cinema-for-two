'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize, SkipBack, SkipForward } from 'lucide-react';
import { formatDuration } from '@/lib/utils';
import { cn } from '@/lib/utils';

interface VideoPlayerProps {
  src: string;
  initialTime?: number;
  onPlaybackEvent?: (event: { type: 'play' | 'pause' | 'seek'; timestamp: number }) => void;
  externalControl?: { type: 'play' | 'pause' | 'seek'; timestamp: number } | null;
  className?: string;
}

export default function VideoPlayer({ src, initialTime, onPlaybackEvent, externalControl, className }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [buffered, setBuffered] = useState(0);
  const hideTimeoutRef = useRef<NodeJS.Timeout>();
  const isExternalRef = useRef(false);

  // Handle external control events (from sync)
  useEffect(() => {
    if (!externalControl || !videoRef.current) return;
    isExternalRef.current = true;

    const video = videoRef.current;
    switch (externalControl.type) {
      case 'play':
        video.currentTime = externalControl.timestamp;
        video.play().catch(() => {});
        setIsPlaying(true);
        break;
      case 'pause':
        video.currentTime = externalControl.timestamp;
        video.pause();
        setIsPlaying(false);
        break;
      case 'seek':
        video.currentTime = externalControl.timestamp;
        break;
    }

    setTimeout(() => { isExternalRef.current = false; }, 100);
  }, [externalControl]);

  const emitEvent = useCallback((type: 'play' | 'pause' | 'seek', timestamp: number) => {
    if (!isExternalRef.current && onPlaybackEvent) {
      onPlaybackEvent({ type, timestamp });
    }
  }, [onPlaybackEvent]);

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
      emitEvent('pause', videoRef.current.currentTime);
    } else {
      videoRef.current.play().catch(() => {});
      setIsPlaying(true);
      emitEvent('play', videoRef.current.currentTime);
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressRef.current || !videoRef.current) return;
    const rect = progressRef.current.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    const time = pos * duration;
    videoRef.current.currentTime = time;
    setCurrentTime(time);
    emitEvent('seek', time);
  };

  const skip = (seconds: number) => {
    if (!videoRef.current) return;
    const newTime = Math.max(0, Math.min(duration, videoRef.current.currentTime + seconds));
    videoRef.current.currentTime = newTime;
    emitEvent('seek', newTime);
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    videoRef.current.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (videoRef.current) {
      videoRef.current.volume = val;
      videoRef.current.muted = val === 0;
    }
    setVolume(val);
    setIsMuted(val === 0);
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  const handleMouseMove = () => {
    setShowControls(true);
    if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    if (isPlaying) {
      hideTimeoutRef.current = setTimeout(() => setShowControls(false), 3000);
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          skip(-10);
          break;
        case 'ArrowRight':
          skip(10);
          break;
        case 'm':
          toggleMute();
          break;
        case 'f':
          toggleFullscreen();
          break;
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isPlaying, duration]);

  return (
    <div
      ref={containerRef}
      className={cn('relative bg-black rounded-2xl overflow-hidden group', className)}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => isPlaying && setShowControls(false)}
    >
      <video
        ref={videoRef}
        src={src}
        className="w-full h-full object-contain cursor-pointer"
        onClick={togglePlay}
        onTimeUpdate={() => {
          if (videoRef.current) {
            setCurrentTime(videoRef.current.currentTime);
          }
        }}
        onLoadedMetadata={() => {
          if (videoRef.current) {
            setDuration(videoRef.current.duration);
            // Restore to saved position if provided
            if (initialTime && initialTime > 0) {
              videoRef.current.currentTime = initialTime;
              setCurrentTime(initialTime);
            }
          }
        }}
        onProgress={() => {
          if (videoRef.current && videoRef.current.buffered.length > 0) {
            setBuffered(videoRef.current.buffered.end(videoRef.current.buffered.length - 1));
          }
        }}
        onEnded={() => setIsPlaying(false)}
        playsInline
      />

      {/* Center play button (shown when paused) */}
      {!isPlaying && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-black/20 cursor-pointer"
          onClick={togglePlay}
        >
          <div className="w-20 h-20 rounded-full bg-cinema-accent/90 flex items-center justify-center shadow-2xl animate-pulse-glow">
            <Play className="w-8 h-8 text-cinema-bg ml-1" fill="currentColor" />
          </div>
        </div>
      )}

      {/* Controls overlay */}
      <div
        className={cn(
          'absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-4 pt-16 transition-opacity duration-500',
          showControls ? 'opacity-100' : 'opacity-0'
        )}
      >
        {/* Progress bar */}
        <div
          ref={progressRef}
          className="relative h-1.5 bg-white/20 rounded-full cursor-pointer mb-4 group/progress hover:h-2.5 transition-all"
          onClick={handleSeek}
        >
          {/* Buffered */}
          <div
            className="absolute inset-y-0 left-0 bg-white/20 rounded-full"
            style={{ width: `${(buffered / duration) * 100}%` }}
          />
          {/* Progress */}
          <div
            className="absolute inset-y-0 left-0 bg-cinema-accent rounded-full"
            style={{ width: `${(currentTime / duration) * 100}%` }}
          >
            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-cinema-accent shadow-lg opacity-0 group-hover/progress:opacity-100 transition-opacity" />
          </div>
        </div>

        {/* Controls row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => skip(-10)} className="text-white/70 hover:text-white transition-colors">
              <SkipBack className="w-5 h-5" />
            </button>
            <button
              onClick={togglePlay}
              className="w-10 h-10 rounded-full bg-cinema-accent flex items-center justify-center hover:bg-cinema-accent-light transition-colors"
            >
              {isPlaying ? (
                <Pause className="w-5 h-5 text-cinema-bg" fill="currentColor" />
              ) : (
                <Play className="w-5 h-5 text-cinema-bg ml-0.5" fill="currentColor" />
              )}
            </button>
            <button onClick={() => skip(10)} className="text-white/70 hover:text-white transition-colors">
              <SkipForward className="w-5 h-5" />
            </button>

            {/* Volume */}
            <div className="flex items-center gap-2 ml-2">
              <button onClick={toggleMute} className="text-white/70 hover:text-white transition-colors">
                {isMuted || volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={isMuted ? 0 : volume}
                onChange={handleVolumeChange}
                className="w-20 accent-cinema-accent"
              />
            </div>

            {/* Time */}
            <span className="text-sm text-white/70 font-mono ml-2">
              {formatDuration(currentTime)} / {formatDuration(duration)}
            </span>
          </div>

          <button onClick={toggleFullscreen} className="text-white/70 hover:text-white transition-colors">
            {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
          </button>
        </div>
      </div>
    </div>
  );
}
