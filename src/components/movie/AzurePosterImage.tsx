'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';

interface AzurePosterImageProps {
  posterUrl: string | null;
  alt: string;
  fill?: boolean;
  width?: number;
  height?: number;
  className?: string;
  sizes?: string;
  fallback?: React.ReactNode;
}

// Cache SAS URLs in memory to avoid re-fetching on every render
const sasCache: Record<string, { url: string; expiresAt: number }> = {};

async function resolvePosterUrl(posterUrl: string): Promise<string> {
  // External URLs (TMDB, etc.) — use directly, no SAS needed
  if (!posterUrl.includes('blob.core.windows.net')) return posterUrl;

  // If it's already a proper SAS URL (has sig= param), use it directly
  if (posterUrl.includes('sig=')) return posterUrl;

  // Check cache
  const cached = sasCache[posterUrl];
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  // Fetch a fresh SAS URL from our API
  const res = await fetch(`/api/movies/poster-url?posterUrl=${encodeURIComponent(posterUrl)}`);
  if (!res.ok) throw new Error('Failed to resolve poster URL');

  const { url } = await res.json();

  // Cache for 3.5 hours (SAS is valid for 4h)
  sasCache[posterUrl] = { url, expiresAt: Date.now() + 3.5 * 60 * 60 * 1000 };
  return url;
}

export default function AzurePosterImage({
  posterUrl,
  alt,
  fill,
  width,
  height,
  className,
  sizes,
  fallback,
}: AzurePosterImageProps) {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!posterUrl) return;
    setError(false);

    resolvePosterUrl(posterUrl)
      .then(setResolvedUrl)
      .catch(() => setError(true));
  }, [posterUrl]);

  if (!posterUrl || error || !resolvedUrl) {
    return <>{fallback ?? null}</>;
  }

  const imageProps = {
    src: resolvedUrl,
    alt,
    className,
    sizes,
    ...(fill ? { fill: true } : { width, height }),
  };

  return <Image {...imageProps} />;
}
