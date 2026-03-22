'use client';

import { Movie } from '@/types';
import { formatDuration } from '@/lib/utils';
import { Play, Clock, Star } from 'lucide-react';
import Link from 'next/link';
import AzurePosterImage from './AzurePosterImage';

interface MovieCardProps {
  movie: Movie;
}

export default function MovieCard({ movie }: MovieCardProps) {
  if (!movie) return null;

  const year = movie.release_date
    ? new Date(movie.release_date).getFullYear()
    : null;

  const displayDuration = movie.runtime
    ? `${Math.floor(movie.runtime / 60)}h ${movie.runtime % 60}m`
    : movie.duration
    ? formatDuration(movie.duration)
    : null;

  const firstGenre = Array.isArray(movie.genres) && movie.genres.length ? movie.genres[0] : null;

  return (
    <Link href={`/movie/${movie.id}`} className="group block">
      <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-cinema-card border border-cinema-border hover:border-cinema-accent/50 transition-all duration-500 hover:shadow-[0_8px_40px_rgba(232,160,191,0.2)] hover:-translate-y-1.5 cursor-pointer">

        {/* Poster image */}
        {movie.poster_url ? (
          <AzurePosterImage
            posterUrl={movie.poster_url}
            alt={movie.title}
            fill
            className="object-cover transition-transform duration-700 group-hover:scale-105"
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            fallback={
              <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-cinema-accent/10 to-cinema-secondary/10">
                <div className="text-5xl">🎬</div>
              </div>
            }
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-cinema-accent/10 to-cinema-secondary/10">
            <div className="text-5xl">🎬</div>
          </div>
        )}

        {/* Rating badge — top right */}
        {movie.rating != null && movie.rating > 0 && (
          <div className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded-lg bg-black/70 backdrop-blur-sm pointer-events-none">
            <Star className="w-3 h-3 text-yellow-400" fill="currentColor" />
            <span className="text-xs font-bold text-white">{movie.rating.toFixed(1)}</span>
          </div>
        )}

        {/* Quality badge — top left */}
        {movie.quality && (
          <div className="absolute top-2 left-2 px-2 py-1 rounded-lg bg-cinema-accent/80 backdrop-blur-sm pointer-events-none">
            <span className="text-[10px] font-bold text-white">{movie.quality}</span>
          </div>
        )}

        {/* Gradient scrim */}
        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black via-black/60 to-transparent pointer-events-none" />

        {/* Title + metadata */}
        <div className="absolute inset-x-0 bottom-0 p-3 pointer-events-none">
          <h3 className="font-display text-sm font-semibold text-white leading-snug line-clamp-2 drop-shadow-md">
            {movie.title}
          </h3>

          {/* Year + Genre row */}
          {(year || firstGenre) && (
            <div className="flex items-center gap-1.5 mt-1 text-white/60 text-[11px]">
              {year && <span>{year}</span>}
              {year && firstGenre && <span className="text-white/30">·</span>}
              {firstGenre && <span>{firstGenre}</span>}
            </div>
          )}

          {/* Duration row */}
          {displayDuration && (
            <div className="flex items-center gap-1 mt-0.5 text-white/50 text-xs">
              <Clock className="w-3 h-3 flex-shrink-0" />
              {displayDuration}
            </div>
          )}
        </div>

        {/* Hover play button */}
        <div className="absolute inset-0 bg-black/25 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
          <div className="w-14 h-14 rounded-full bg-cinema-accent/90 flex items-center justify-center shadow-xl transform scale-75 group-hover:scale-100 transition-transform duration-300">
            <Play className="w-6 h-6 text-cinema-bg ml-0.5" fill="currentColor" />
          </div>
        </div>

      </div>
    </Link>
  );
}