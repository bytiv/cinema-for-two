'use client';

import { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DurationInputProps {
  value: number | null;           // total seconds
  onChange: (seconds: number | null) => void;
  detected?: number | null;       // auto-detected seconds (upload page)
  label?: string;
  className?: string;
}

function toHMS(seconds: number | null): { h: string; m: string; s: string } {
  if (!seconds || seconds <= 0) return { h: '', m: '', s: '' };
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return {
    h: h > 0 ? String(h) : '',
    m: m > 0 || h > 0 ? String(m) : '',
    s: String(s),
  };
}

function toSeconds(h: string, m: string, s: string): number | null {
  const hh = parseInt(h) || 0;
  const mm = parseInt(m) || 0;
  const ss = parseInt(s) || 0;
  const total = hh * 3600 + mm * 60 + ss;
  return total > 0 ? total : null;
}

export default function DurationInput({ value, onChange, detected, label = 'Duration', className }: DurationInputProps) {
  const [h, setH] = useState('');
  const [m, setM] = useState('');
  const [s, setS] = useState('');

  // Sync inbound value → fields (e.g. when auto-detected)
  useEffect(() => {
    const hms = toHMS(value);
    setH(hms.h);
    setM(hms.m);
    setS(hms.s);
  }, [value]);

  const handleChange = (field: 'h' | 'm' | 's', raw: string) => {
    // Only allow non-negative integers
    const clean = raw.replace(/[^0-9]/g, '');
    const newH = field === 'h' ? clean : h;
    const newM = field === 'm' ? clean : m;
    const newS = field === 's' ? clean : s;
    if (field === 'h') setH(clean);
    if (field === 'm') setM(clean);
    if (field === 's') setS(clean);
    onChange(toSeconds(newH, newM, newS));
  };

  const handleReset = () => {
    if (!detected) return;
    const hms = toHMS(detected);
    setH(hms.h); setM(hms.m); setS(hms.s);
    onChange(detected);
  };

  const showReset = detected && value !== detected;

  const fieldCls = 'w-full rounded-xl bg-cinema-card border border-cinema-border px-3 py-3 text-cinema-text text-center placeholder:text-cinema-text-dim focus:outline-none focus:border-cinema-accent/50 focus:ring-2 focus:ring-cinema-accent/20 transition-all';

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm font-medium text-cinema-text-muted">
          <Clock className="w-4 h-4 text-cinema-warm" />
          {label}
          {detected && value === detected && (
            <span className="text-xs font-normal text-cinema-success">✓ auto-detected</span>
          )}
        </label>
        {showReset && (
          <button
            type="button"
            onClick={handleReset}
            className="text-xs px-2.5 py-1 rounded-lg bg-cinema-success/10 text-cinema-success border border-cinema-success/20 hover:bg-cinema-success/20 transition-colors"
          >
            Reset to auto
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        {/* Hours */}
        <div className="flex-1 flex flex-col items-center gap-1">
          <input
            type="text"
            inputMode="numeric"
            placeholder="0"
            value={h}
            onChange={(e) => handleChange('h', e.target.value)}
            className={fieldCls}
          />
          <span className="text-[10px] text-cinema-text-dim uppercase tracking-wide">hr</span>
        </div>

        <span className="text-cinema-text-dim font-bold mb-4">:</span>

        {/* Minutes */}
        <div className="flex-1 flex flex-col items-center gap-1">
          <input
            type="text"
            inputMode="numeric"
            placeholder="0"
            value={m}
            onChange={(e) => handleChange('m', e.target.value)}
            className={fieldCls}
          />
          <span className="text-[10px] text-cinema-text-dim uppercase tracking-wide">min</span>
        </div>

        <span className="text-cinema-text-dim font-bold mb-4">:</span>

        {/* Seconds */}
        <div className="flex-1 flex flex-col items-center gap-1">
          <input
            type="text"
            inputMode="numeric"
            placeholder="0"
            value={s}
            onChange={(e) => handleChange('s', e.target.value)}
            className={fieldCls}
          />
          <span className="text-[10px] text-cinema-text-dim uppercase tracking-wide">sec</span>
        </div>
      </div>
    </div>
  );
}