'use client';

import { Movie } from '@/types';
import { formatDuration } from '@/lib/utils';
import { Play, Star } from 'lucide-react';
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

  const genres = Array.isArray(movie.genres) ? movie.genres : [];
  const overview = movie.description || '';

  return (
    <Link href={`/movie/${movie.id}`} className="group block">
      <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-cinema-card border border-cinema-border transition-all duration-300 ease-in-out hover:scale-[1.05] hover:shadow-[0_8px_40px_rgba(232,160,191,0.25)] hover:border-cinema-accent/50 cursor-pointer">

        {/* Poster image — always visible */}
        {movie.poster_url ? (
          <AzurePosterImage
            posterUrl={movie.poster_url}
            alt={movie.title}
            fill
            className="object-cover"
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

        {/* Hover overlay — only shows on devices with hover (desktop) */}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-all duration-300 ease-in-out hidden sm:flex flex-col justify-end p-3.5">

          {/* Title */}
          <h3 className="font-display text-[15px] font-semibold text-cinema-accent leading-snug line-clamp-2 drop-shadow-md">
            {movie.title}
          </h3>

          {/* Year + Rating row */}
          <div className="flex items-center justify-between mt-1.5">
            <div className="flex items-center gap-2 text-xs text-cinema-text-muted">
              {year && <span>{year}</span>}
              {year && displayDuration && <span className="text-cinema-text-dim">·</span>}
              {displayDuration && <span>{displayDuration}</span>}
            </div>
            {movie.rating != null && movie.rating > 0 && (
              <div className="flex items-center gap-1 text-cinema-accent">
                <span className="text-xs font-bold">{movie.rating.toFixed(1)}</span>
                <Star className="w-3.5 h-3.5" fill="currentColor" />
              </div>
            )}
          </div>

          {/* Genres */}
          {genres.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {genres.slice(0, 3).map((g) => (
                <span key={g} className="px-1.5 py-0.5 rounded bg-cinema-secondary/20 text-[10px] text-cinema-secondary-light font-medium">
                  {g}
                </span>
              ))}
            </div>
          )}

          {/* Description snippet */}
          {overview && (
            <p className="text-[11px] text-cinema-text-dim italic leading-relaxed mt-2 line-clamp-3">
              {overview}
            </p>
          )}

          {/* Play button hint */}
          <div className="flex items-center gap-1.5 mt-2.5 text-cinema-accent text-xs font-medium opacity-80">
            <Play className="w-3.5 h-3.5" fill="currentColor" />
            <span>Watch now</span>
          </div>
        </div>

        {/* Static bottom scrim — visible when NOT hovering (on desktop it hides on hover) */}
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/80 via-black/40 to-transparent pointer-events-none sm:group-hover:opacity-0 transition-opacity duration-300" />

        {/* Static title + year — visible when NOT hovering (on desktop it hides on hover) */}
        <div className="absolute inset-x-0 bottom-0 p-3 pointer-events-none sm:group-hover:opacity-0 transition-opacity duration-300">
          <h3 className="font-display text-sm font-semibold text-white leading-snug line-clamp-2 drop-shadow-md">
            {movie.title}
          </h3>
          {(year || (movie.rating != null && movie.rating > 0)) && (
            <div className="flex items-center justify-between mt-1">
              <span className="text-white/55 text-[11px]">{year}</span>
              {movie.rating != null && movie.rating > 0 && (
                <div className="flex items-center gap-1">
                  <span className="text-[11px] font-bold text-yellow-300">{movie.rating.toFixed(1)}</span>
                  <Star className="w-3 h-3 text-yellow-300" fill="currentColor" />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}