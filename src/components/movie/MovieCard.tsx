'use client';

import { Movie } from '@/types';
import { formatDuration, formatRelativeTime } from '@/lib/utils';
import { Play, Clock } from 'lucide-react';
import Link from 'next/link';
import AzurePosterImage from './AzurePosterImage';

interface MovieCardProps {
  movie: Movie;
}

export default function MovieCard({ movie }: MovieCardProps) {
  return (
    <Link href={`/movie/${movie.id}`} className="group block">
      <div className="relative rounded-2xl overflow-hidden bg-cinema-card border border-cinema-border hover:border-cinema-accent/40 transition-all duration-500 hover:shadow-[0_0_40px_rgba(232,160,191,0.18)] hover:-translate-y-1.5">

        {/* Poster */}
        <div className="relative aspect-[4/3] bg-cinema-surface overflow-hidden">
          {movie.poster_url ? (
            <AzurePosterImage
              posterUrl={movie.poster_url}
              alt={movie.title}
              fill
              className="object-cover transition-transform duration-700 group-hover:scale-105"
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
              fallback={
                <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-cinema-accent/10 to-cinema-secondary/10">
                  <div className="text-6xl">🎬</div>
                </div>
              }
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-cinema-accent/10 to-cinema-secondary/10">
              <div className="text-6xl">🎬</div>
            </div>
          )}

          {/* Hover overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-cinema-bg/90 via-cinema-bg/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 flex items-center justify-center">
            <div className="w-16 h-16 rounded-full bg-cinema-accent/90 flex items-center justify-center shadow-lg transform scale-50 group-hover:scale-100 transition-transform duration-500">
              <Play className="w-7 h-7 text-cinema-bg ml-0.5" fill="currentColor" />
            </div>
          </div>
        </div>

        {/* Info — fixed height so all cards are the same size */}
        <div className="p-5 h-[120px] flex flex-col justify-between">
          <div>
            <h3 className="font-display text-xl font-semibold text-cinema-text truncate group-hover:text-cinema-accent transition-colors">
              {movie.title}
            </h3>
            {movie.description && (
              <p className="text-sm text-cinema-text-dim line-clamp-1 mt-0.5">
                {movie.description}
              </p>
            )}
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-sm text-cinema-text-dim">
              <Clock className="w-3.5 h-3.5" />
              {movie.duration ? formatDuration(movie.duration) : '—'}
            </div>
            <div className="text-sm text-cinema-text-dim">
              {formatRelativeTime(movie.created_at)}
            </div>
          </div>
        </div>

      </div>
    </Link>
  );
}