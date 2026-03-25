/**
 * POST /api/subtitles/cycle
 *
 * Cycles to the next subtitle option for a given language.
 * If the next option hasn't been downloaded yet, downloads it on demand.
 * If we're at the end, loops back to #1 (already downloaded).
 *
 * Body: { movie_id: string, lang: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient }              from '@supabase/supabase-js';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { generateUploadSasUrl, generateReadSasUrl, CONTAINERS } from '@/lib/azure-blob';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const LANG_LABELS: Record<string, string> = {
  en: 'English', ar: 'Arabic', fr: 'French', es: 'Spanish', de: 'German',
  it: 'Italian', ja: 'Japanese', ko: 'Korean', zh: 'Chinese', pt: 'Portuguese',
  ru: 'Russian', tr: 'Turkish',
};

// ── Helpers (same as fetch route) ────────────────────────────────────────

async function extractSrtFromZip(zipBuffer: ArrayBuffer): Promise<{ content: string; format: string } | null> {
  try {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(zipBuffer);
    for (const ext of ['.srt', '.vtt', '.ass', '.ssa']) {
      for (const [name, file] of Object.entries(zip.files)) {
        if (name.toLowerCase().endsWith(ext) && !file.dir) {
          let content = await file.async('string');
          if (content.includes('\uFFFD') || (ext === '.ass' && !content.includes('Dialogue'))) {
            const bytes = await file.async('uint8array');
            const d16 = new TextDecoder('utf-16le');
            const a16 = d16.decode(bytes);
            if (a16.includes('Dialogue') || a16.includes('[Script')) content = a16;
            else {
              const dLatin = new TextDecoder('iso-8859-1');
              const aLatin = dLatin.decode(bytes);
              if (aLatin.includes('Dialogue') || aLatin.includes('[Script')) content = aLatin;
            }
          }
          return { content, format: ext };
        }
      }
    }
  } catch {}
  return null;
}

function srtToVtt(srt: string): string {
  return 'WEBVTT\n\n' + srt.replace(/\r\n/g, '\n').replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
}

function assToVtt(ass: string): string {
  const cleaned = ass.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = cleaned.split('\n');
  const cues: string[] = [];
  let startIdx = 1, endIdx = 2, textIdx = 9;
  let inEvents = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.toLowerCase() === '[events]') { inEvents = true; continue; }
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) { inEvents = false; continue; }
    if (inEvents && trimmed.toLowerCase().startsWith('format:')) {
      const fields = trimmed.substring('format:'.length).split(',').map((f) => f.trim().toLowerCase());
      startIdx = fields.indexOf('start'); if (startIdx === -1) startIdx = 1;
      endIdx = fields.indexOf('end'); if (endIdx === -1) endIdx = 2;
      textIdx = fields.indexOf('text'); if (textIdx === -1) textIdx = 9;
      break;
    }
  }

  for (const line of lines) {
    if (!line.trim().match(/^(Dialogue|Comment)\s*:/i)) continue;
    const colonPos = line.indexOf(':');
    if (colonPos === -1) continue;
    const afterColon = line.substring(colonPos + 1);
    const parts: string[] = [];
    let current = '', fieldCount = 0;
    for (let i = 0; i < afterColon.length; i++) {
      if (afterColon[i] === ',' && fieldCount < textIdx) { parts.push(current); current = ''; fieldCount++; }
      else current += afterColon[i];
    }
    parts.push(current);
    if (parts.length <= Math.max(startIdx, endIdx, textIdx)) continue;
    const start = parts[startIdx]?.trim();
    const end = parts[endIdx]?.trim();
    const text = parts[textIdx]?.trim().replace(/\\N/g, '\n').replace(/\\n/g, '\n').replace(/\{[^}]*\}/g, '').replace(/<[^>]*>/g, '').trim();
    if (!start || !end || !text) continue;
    const fmt = (t: string) => { const m = t.match(/(\d+):(\d{2}):(\d{2})\.(\d{2,3})/); if (!m) return t; return `${m[1].padStart(2,'0')}:${m[2]}:${m[3]}.${m[4].length===2?m[4]+'0':m[4]}`; };
    cues.push(`${fmt(start)} --> ${fmt(end)}\n${text}`);
  }
  return 'WEBVTT\n\n' + cues.join('\n\n');
}

function convertToVtt(content: string, format: string): string {
  if (format === '.ass' || format === '.ssa') return assToVtt(content);
  if (format === '.vtt') return content;
  return srtToVtt(content);
}

async function uploadVtt(userId: string, lang: string, idx: number, vttContent: string): Promise<string | null> {
  const blobName = `${userId}/${Date.now()}-auto-${lang}-${idx}.vtt`;
  const uploadUrl = generateUploadSasUrl(CONTAINERS.subtitles || 'subtitles', blobName, 1);
  const readUrl = generateReadSasUrl(CONTAINERS.subtitles || 'subtitles', blobName, 8760);
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': 'text/vtt' },
    body: vttContent,
  });
  return res.ok ? readUrl : null;
}

// ── POST handler ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { movie_id, lang } = await req.json();
    if (!movie_id || !lang) return NextResponse.json({ error: 'movie_id and lang required' }, { status: 400 });

    const { data: movie } = await supabaseAdmin
      .from('movies')
      .select('uploaded_by, subtitles, subtitle_options')
      .eq('id', movie_id)
      .single();
    if (!movie) return NextResponse.json({ error: 'Movie not found' }, { status: 404 });

    const options = movie.subtitle_options?.[lang];
    if (!options || !options.candidates || options.candidates.length <= 1) {
      return NextResponse.json({ error: 'No alternative subtitles available', total: options?.candidates?.length || 0 }, { status: 404 });
    }

    const currentActive = options.active_index ?? 0;
    const totalCandidates = options.candidates.length;
    const nextIdx = (currentActive + 1) % totalCandidates;

    // Check if we've already downloaded this index
    const alreadyDownloaded = options.downloaded?.[nextIdx];

    let newUrl: string;
    let newReleaseName: string;

    if (alreadyDownloaded) {
      // Already downloaded — just swap
      newUrl = alreadyDownloaded.url;
      newReleaseName = alreadyDownloaded.release_name;
      console.log(`[subs/cycle] ${lang} → #${nextIdx + 1}/${totalCandidates} (cached)`);
    } else {
      // Need to download this candidate
      const candidate = options.candidates[nextIdx];
      console.log(`[subs/cycle] ${lang} → #${nextIdx + 1}/${totalCandidates} downloading from ${candidate.source} (${candidate.release_name.slice(0, 50)})`);

      const dlRes = await fetch(candidate.source_url, {
        headers: { 'User-Agent': 'CinemaForTwo v1.0' },
        signal: AbortSignal.timeout(20000),
      });
      if (!dlRes.ok) {
        return NextResponse.json({ error: 'Failed to download subtitle' }, { status: 502 });
      }

      let subContent: string | null = null;
      let format = '.srt';

      if (candidate.is_zip) {
        const buf = await dlRes.arrayBuffer();
        const extracted = await extractSrtFromZip(buf);
        if (!extracted) return NextResponse.json({ error: 'Failed to extract subtitle from zip' }, { status: 500 });
        subContent = extracted.content;
        format = extracted.format;
      } else {
        subContent = await dlRes.text();
        if (subContent.includes('[Script Info]') || subContent.includes('Dialogue:')) format = '.ass';
        else if (subContent.startsWith('WEBVTT')) format = '.vtt';
      }

      if (!subContent) return NextResponse.json({ error: 'Empty subtitle content' }, { status: 500 });

      const vttContent = convertToVtt(subContent, format);
      const readUrl = await uploadVtt(movie.uploaded_by, lang, nextIdx + 1, vttContent);
      if (!readUrl) return NextResponse.json({ error: 'Failed to upload subtitle' }, { status: 500 });

      newUrl = readUrl;
      newReleaseName = candidate.release_name;

      // Store in downloaded array (sparse — index matches candidate index)
      const downloadedArr = [...(options.downloaded || [])];
      while (downloadedArr.length <= nextIdx) downloadedArr.push(null as any);
      downloadedArr[nextIdx] = { url: readUrl, release_name: candidate.release_name };
      options.downloaded = downloadedArr;
    }

    // Update active index
    options.active_index = nextIdx;

    // Update the active subtitle URL
    const updatedSubs = (movie.subtitles || []).map((s: any) =>
      s.lang === lang ? { ...s, url: newUrl } : s
    );

    const updatedOptions = { ...(movie.subtitle_options || {}), [lang]: options };

    await supabaseAdmin.from('movies').update({
      subtitles: updatedSubs,
      subtitle_options: updatedOptions,
    }).eq('id', movie_id);

    return NextResponse.json({
      subtitles: updatedSubs,
      subtitle_options: updatedOptions,
      active_index: nextIdx,
      total: totalCandidates,
      downloaded_count: options.downloaded.filter(Boolean).length,
      release_name: newReleaseName,
      message: `${LANG_LABELS[lang] || lang} → ${nextIdx + 1}/${totalCandidates}`,
    });
  } catch (err: any) {
    console.error('[subs/cycle]', err);
    return NextResponse.json({ error: err.message || 'Failed' }, { status: 500 });
  }
}