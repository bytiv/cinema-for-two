'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import Navbar from '@/components/layout/Navbar';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { Upload, Film, Image as ImageIcon, X, CheckCircle, AlertCircle, Subtitles, Plus, Globe } from 'lucide-react';
import { formatFileSize, generateBlobName, getVideoMimeType } from '@/lib/utils';
import { cn } from '@/lib/utils';

const ACCEPTED_VIDEO = '.mp4,.mkv,.avi,.mov,.webm,.wmv,.m4v';
const ACCEPTED_IMAGE = '.jpg,.jpeg,.png,.webp,.gif';
const ACCEPTED_SUBTITLE = '.srt,.vtt';
const MAX_POSTER_SIZE = 10 * 1024 * 1024;

const LANGUAGE_OPTIONS = [
  { code: 'en', label: 'English' },
  { code: 'ar', label: 'Arabic' },
  { code: 'fr', label: 'French' },
  { code: 'es', label: 'Spanish' },
  { code: 'de', label: 'German' },
  { code: 'it', label: 'Italian' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'zh', label: 'Chinese' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'ru', label: 'Russian' },
  { code: 'tr', label: 'Turkish' },
];

interface SubtitleEntry {
  id: string;
  file: File;
  lang: string;
  label: string;
}

export default function UploadPage() {
  const router = useRouter();
  const supabase = createClient();

  const [movieFile, setMovieFile] = useState<File | null>(null);
  const [posterFile, setPosterFile] = useState<File | null>(null);
  const [posterPreview, setPosterPreview] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [subtitleEntries, setSubtitleEntries] = useState<SubtitleEntry[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStage, setUploadStage] = useState('');
  const [error, setError] = useState('');
  const [dragActive, setDragActive] = useState(false);

  const handleMovieDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('video/')) {
      setMovieFile(file);
      if (!title) setTitle(file.name.replace(/\.[^/.]+$/, '').replace(/[_.-]/g, ' ').trim());
    }
  }, [title]);

  const handleMovieSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setMovieFile(file);
      if (!title) setTitle(file.name.replace(/\.[^/.]+$/, '').replace(/[_.-]/g, ' ').trim());
    }
  };

  const handlePosterSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > MAX_POSTER_SIZE) { setError('Poster image must be under 10MB'); return; }
      setPosterFile(file);
      setPosterPreview(URL.createObjectURL(file));
    }
  };

  const handleSubtitleAdd = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const newEntries: SubtitleEntry[] = files.map((file) => {
      // Auto-detect language from filename e.g. movie.en.srt → en
      const parts = file.name.replace(/\.(srt|vtt)$/i, '').split('.');
      const lastPart = parts[parts.length - 1].toLowerCase();
      const detected = LANGUAGE_OPTIONS.find((l) => l.code === lastPart);
      return {
        id: Math.random().toString(36).slice(2),
        file,
        lang: detected?.code || 'en',
        label: detected?.label || 'English',
      };
    });
    setSubtitleEntries((prev) => [...prev, ...newEntries]);
    e.target.value = '';
  };

  const updateSubtitleLang = (id: string, lang: string) => {
    const opt = LANGUAGE_OPTIONS.find((l) => l.code === lang);
    setSubtitleEntries((prev) =>
      prev.map((s) => s.id === id ? { ...s, lang, label: opt?.label || lang } : s)
    );
  };

  const removeSubtitle = (id: string) => {
    setSubtitleEntries((prev) => prev.filter((s) => s.id !== id));
  };

  const srtToVtt = async (file: File): Promise<Blob> => {
    const text = await file.text();
    const vtt = 'WEBVTT\n\n' + text
      .replace(/\r\n/g, '\n')
      .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2'); // SRT uses comma, VTT uses dot
    return new Blob([vtt], { type: 'text/vtt' });
  };

  const uploadSubtitleFile = async (entry: SubtitleEntry, userId: string): Promise<{ label: string; lang: string; url: string }> => {
    // Always upload as .vtt so the browser <track> element works natively
    const baseName = entry.file.name.replace(/\.(srt|vtt)$/i, '');
    const blobName = `${userId}/${Date.now()}-${baseName}.vtt`;
    const sasRes = await fetch('/api/upload/sas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ container: 'subtitles', blobName, contentType: 'text/vtt' }),
    });
    if (!sasRes.ok) throw new Error('Failed to get subtitle upload URL');
    const { uploadUrl, readUrl } = await sasRes.json();

    // Convert SRT → VTT if needed
    const isSrt = entry.file.name.toLowerCase().endsWith('.srt');
    const body = isSrt ? await srtToVtt(entry.file) : entry.file;

    await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': 'text/vtt' },
      body,
    });
    return { label: entry.label, lang: entry.lang, url: readUrl };
  };

  const handleUpload = async () => {
    if (!movieFile || !title.trim()) return;
    setUploading(true);
    setError('');
    setUploadProgress(0);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Step 1: Movie SAS
      setUploadStage('Preparing upload...');
      const blobName = generateBlobName(user.id, movieFile.name);
      const sasRes = await fetch('/api/upload/sas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ container: 'movies', blobName, contentType: getVideoMimeType(movieFile.name) }),
      });
      if (!sasRes.ok) throw new Error('Failed to get upload URL');
      const { uploadUrl } = await sasRes.json();

      // Step 2: Upload movie
      setUploadStage('Uploading movie...');
      const xhr = new XMLHttpRequest();
      await new Promise<void>((resolve, reject) => {
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 80));
        });
        xhr.addEventListener('load', () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed: ${xhr.status}`)));
        xhr.addEventListener('error', () => reject(new Error('Upload failed')));
        xhr.open('PUT', uploadUrl);
        xhr.setRequestHeader('x-ms-blob-type', 'BlockBlob');
        xhr.setRequestHeader('Content-Type', getVideoMimeType(movieFile.name));
        xhr.send(movieFile);
      });

      setUploadProgress(82);

      // Step 3: Upload poster
      let posterBlobName = null;
      if (posterFile) {
        setUploadStage('Uploading poster...');
        const posterName = generateBlobName(user.id, posterFile.name);
        const posterSasRes = await fetch('/api/upload/sas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ container: 'posters', blobName: posterName, contentType: posterFile.type }),
        });
        if (posterSasRes.ok) {
          const { uploadUrl: posterUploadUrl } = await posterSasRes.json();
          await fetch(posterUploadUrl, { method: 'PUT', headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': posterFile.type }, body: posterFile });
          posterBlobName = posterName;
        }
      }

      setUploadProgress(87);

      // Step 4: Upload subtitles
      let subtitleData: { label: string; lang: string; url: string }[] = [];
      if (subtitleEntries.length > 0) {
        setUploadStage(`Uploading subtitles...`);
        subtitleData = await Promise.all(subtitleEntries.map((s) => uploadSubtitleFile(s, user.id)));
      }

      setUploadProgress(93);

      // Step 5: Save to Supabase
      setUploadStage('Saving movie info...');
      const movieData = {
        title: title.trim(),
        description: description.trim() || null,
        blob_name: blobName,
        blob_url: `https://${process.env.NEXT_PUBLIC_AZURE_STORAGE_ACCOUNT_NAME}.blob.core.windows.net/movies/${blobName}`,
        poster_url: posterBlobName
          ? `https://${process.env.NEXT_PUBLIC_AZURE_STORAGE_ACCOUNT_NAME}.blob.core.windows.net/posters/${posterBlobName}`
          : null,
        file_size: movieFile.size,
        format: movieFile.name.split('.').pop()?.toLowerCase() || 'mp4',
        uploaded_by: user.id,
        subtitles: subtitleData,
      };

      const saveRes = await fetch('/api/movies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(movieData),
      });
      if (!saveRes.ok) throw new Error('Failed to save movie metadata');

      const { movie } = await saveRes.json();
      setUploadProgress(100);
      setUploadStage('Done!');
      setTimeout(() => router.push(`/movie/${movie.id}`), 1000);
    } catch (err: any) {
      setError(err.message || 'Upload failed. Please try again.');
      setUploading(false);
    }
  };

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="relative z-10 pt-24 pb-12 px-4 sm:px-6 lg:px-8 max-w-2xl mx-auto">
        <div className="mb-8">
          <h1 className="font-display text-3xl font-bold text-cinema-text mb-2">
            Upload a Movie <span className="text-cinema-accent">🎞️</span>
          </h1>
          <p className="text-cinema-text-muted">Add a movie to your shared collection</p>
        </div>

        <div className="space-y-6">
          {/* Movie drop zone */}
          <div
            className={cn(
              'relative rounded-2xl border-2 border-dashed p-8 text-center transition-all duration-300 cursor-pointer',
              dragActive ? 'border-cinema-accent bg-cinema-accent/5'
                : movieFile ? 'border-cinema-success/50 bg-cinema-success/5'
                : 'border-cinema-border hover:border-cinema-accent/50 bg-cinema-card/30'
            )}
            onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleMovieDrop}
            onClick={() => document.getElementById('movieInput')?.click()}
          >
            <input id="movieInput" type="file" accept={ACCEPTED_VIDEO} onChange={handleMovieSelect} className="hidden" />
            {movieFile ? (
              <div className="flex items-center justify-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-cinema-success/10 flex items-center justify-center">
                  <CheckCircle className="w-6 h-6 text-cinema-success" />
                </div>
                <div className="text-left">
                  <p className="font-medium text-cinema-text">{movieFile.name}</p>
                  <p className="text-sm text-cinema-text-muted">{formatFileSize(movieFile.size)}</p>
                </div>
                <button onClick={(e) => { e.stopPropagation(); setMovieFile(null); }} className="ml-4 text-cinema-text-dim hover:text-cinema-error transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
            ) : (
              <>
                <div className="w-16 h-16 rounded-2xl bg-cinema-accent/10 flex items-center justify-center mx-auto mb-4">
                  <Upload className="w-8 h-8 text-cinema-accent" />
                </div>
                <p className="font-medium text-cinema-text mb-1">Drop your movie file here</p>
                <p className="text-sm text-cinema-text-muted">or click to browse</p>
                <p className="text-xs text-cinema-text-dim mt-2">Supports MP4, MKV, AVI, MOV, WebM</p>
              </>
            )}
          </div>

          {/* Movie details */}
          <div className="bg-cinema-card/50 backdrop-blur-sm border border-cinema-border rounded-2xl p-6 space-y-4">
            <Input id="title" label="Movie Title" placeholder="e.g. Our Favorite Movie" icon={<Film className="w-4 h-4" />} value={title} onChange={(e) => setTitle(e.target.value)} required />
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-cinema-text-muted">Description (optional)</label>
              <textarea
                placeholder="What's this movie about?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="w-full rounded-xl bg-cinema-card border border-cinema-border px-4 py-3 text-cinema-text placeholder:text-cinema-text-dim focus:outline-none focus:border-cinema-accent/50 focus:ring-2 focus:ring-cinema-accent/20 transition-all resize-none"
              />
            </div>

            {/* Poster upload */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-cinema-text-muted">Poster Image (optional)</label>
              <div className="flex items-start gap-4">
                {posterPreview ? (
                  <div className="relative w-20 h-28 rounded-lg overflow-hidden bg-cinema-surface flex-shrink-0">
                    <img src={posterPreview} alt="Poster" className="w-full h-full object-cover" />
                    <button onClick={() => { setPosterFile(null); setPosterPreview(null); }} className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 flex items-center justify-center">
                      <X className="w-3 h-3 text-white" />
                    </button>
                  </div>
                ) : (
                  <label className="w-20 h-28 rounded-lg border-2 border-dashed border-cinema-border hover:border-cinema-accent/50 flex flex-col items-center justify-center cursor-pointer transition-colors flex-shrink-0">
                    <ImageIcon className="w-5 h-5 text-cinema-text-dim mb-1" />
                    <span className="text-[10px] text-cinema-text-dim">Add poster</span>
                    <input type="file" accept={ACCEPTED_IMAGE} onChange={handlePosterSelect} className="hidden" />
                  </label>
                )}
                <p className="text-xs text-cinema-text-dim mt-2">A poster helps identify the movie in the library. JPG, PNG, or WebP under 10MB.</p>
              </div>
            </div>
          </div>

          {/* Subtitles */}
          <div className="bg-cinema-card/50 backdrop-blur-sm border border-cinema-border rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-display text-base font-semibold text-cinema-text flex items-center gap-2">
                  <Globe className="w-4 h-4 text-cinema-secondary" />
                  Subtitles
                  <span className="text-xs font-normal text-cinema-text-dim">(optional)</span>
                </h3>
                <p className="text-xs text-cinema-text-dim mt-0.5">Upload .srt or .vtt files — supports multiple languages</p>
              </div>
              <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-cinema-secondary/15 text-cinema-secondary hover:bg-cinema-secondary/25 border border-cinema-secondary/20 transition-colors cursor-pointer">
                <Plus className="w-3.5 h-3.5" /> Add subtitles
                <input type="file" accept={ACCEPTED_SUBTITLE} multiple onChange={handleSubtitleAdd} className="hidden" />
              </label>
            </div>

            {subtitleEntries.length === 0 ? (
              <div className="border-2 border-dashed border-cinema-border rounded-xl p-6 text-center">
                <Globe className="w-8 h-8 text-cinema-text-dim mx-auto mb-2 opacity-40" />
                <p className="text-sm text-cinema-text-dim">No subtitles added</p>
                <p className="text-xs text-cinema-text-dim mt-1 opacity-60">
                  Tip: name your files <span className="font-mono text-cinema-secondary/80">movie.en.srt</span> and the language will be detected automatically
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {subtitleEntries.map((entry) => (
                  <div key={entry.id} className="flex items-center gap-3 p-3 rounded-xl bg-cinema-surface border border-cinema-border">
                    <div className="w-8 h-8 rounded-lg bg-cinema-secondary/10 flex items-center justify-center flex-shrink-0">
                      <Globe className="w-4 h-4 text-cinema-secondary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-cinema-text truncate">{entry.file.name}</p>
                      <p className="text-xs text-cinema-text-dim">{formatFileSize(entry.file.size)}</p>
                    </div>
                    <select
                      value={entry.lang}
                      onChange={(e) => updateSubtitleLang(entry.id, e.target.value)}
                      className="text-xs rounded-lg bg-cinema-card border border-cinema-border px-2 py-1.5 text-cinema-text focus:outline-none focus:border-cinema-accent/50 cursor-pointer"
                    >
                      {LANGUAGE_OPTIONS.map((l) => (
                        <option key={l.code} value={l.code}>{l.label}</option>
                      ))}
                    </select>
                    <button onClick={() => removeSubtitle(entry.id)} className="text-cinema-text-dim hover:text-cinema-error transition-colors flex-shrink-0">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-3 p-4 rounded-xl bg-cinema-error/10 border border-cinema-error/20">
              <AlertCircle className="w-5 h-5 text-cinema-error flex-shrink-0" />
              <p className="text-sm text-cinema-error">{error}</p>
            </div>
          )}

          {/* Progress */}
          {uploading && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-cinema-text-muted">{uploadStage}</span>
                <span className="text-cinema-accent font-mono">{uploadProgress}%</span>
              </div>
              <div className="h-2 bg-cinema-card rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-cinema-accent to-cinema-warm rounded-full transition-all duration-500 ease-out" style={{ width: `${uploadProgress}%` }} />
              </div>
            </div>
          )}

          <Button onClick={handleUpload} disabled={!movieFile || !title.trim() || uploading} loading={uploading} size="lg" className="w-full" icon={<Upload className="w-5 h-5" />}>
            {uploading ? 'Uploading...' : 'Upload Movie'}
          </Button>
        </div>
      </main>
    </div>
  );
}