'use client';

import { Movie } from '@/types';
import { formatDuration, formatFileSize, formatRelativeTime } from '@/lib/utils';
import { Play, Clock, HardDrive, User } from 'lucide-react';
import Link from 'next/link';
import AzurePosterImage from './AzurePosterImage';

interface MovieCardProps {
  movie: Movie;
}

export default function MovieCard({ movie }: MovieCardProps) {
  return (
    <Link href={`/movie/${movie.id}`} className="group block">
      <div className="relative rounded-2xl overflow-hidden bg-cinema-card border border-cinema-border hover:border-cinema-accent/40 transition-all duration-500 hover:shadow-[0_0_30px_rgba(232,160,191,0.15)] hover:-translate-y-1">
        {/* Poster */}
        <div className="relative aspect-[2/3] bg-cinema-surface overflow-hidden">
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

          {/* Hover overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-cinema-bg/90 via-cinema-bg/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 flex items-center justify-center">
            <div className="w-14 h-14 rounded-full bg-cinema-accent/90 flex items-center justify-center shadow-lg transform scale-50 group-hover:scale-100 transition-transform duration-500">
              <Play className="w-6 h-6 text-cinema-bg ml-0.5" fill="currentColor" />
            </div>
          </div>

          {/* Duration badge */}
          {movie.duration && (
            <div className="absolute top-3 right-3 bg-cinema-bg/70 backdrop-blur-sm text-cinema-text text-xs px-2 py-1 rounded-lg flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatDuration(movie.duration)}
            </div>
          )}
        </div>

        {/* Info */}
        <div className="p-4 space-y-2">
          <h3 className="font-display text-lg font-semibold text-cinema-text truncate group-hover:text-cinema-accent transition-colors">
            {movie.title}
          </h3>
          {movie.description && (
            <p className="text-sm text-cinema-text-muted line-clamp-2 leading-relaxed">
              {movie.description}
            </p>
          )}
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-1.5 text-xs text-cinema-text-dim">
              <HardDrive className="w-3 h-3" />
              {formatFileSize(movie.file_size)}
            </div>
            <div className="text-xs text-cinema-text-dim">
              {formatRelativeTime(movie.created_at)}
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}
