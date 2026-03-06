'use client';

import { useEffect, useRef } from 'react';

// Replicates the very first star pattern from the original globals.css:
//   radial-gradient(2px 2px at 20px 30px, rgba(232,160,191,0.3), transparent)
//   radial-gradient(2px 2px at 40px 70px, rgba(167,139,250,0.2), transparent)
//   radial-gradient(1px 1px at 90px 40px, rgba(232,160,191,0.4), transparent)
//   radial-gradient(1px 1px at 130px 80px, rgba(251,191,126,0.2), transparent)
//   radial-gradient(2px 2px at 160px 30px, rgba(232,160,191,0.2), transparent)
//   background-size: 200px 100px  (tiled)
//
// Since we're drawing on canvas we scatter many copies of this 5-star tile
// across the viewport so the density matches the original tiled look.
// Each star flickers independently via sin(t * speed + phase).

interface Star {
  x: number; y: number;
  r: number; g: number; b: number;
  baseAlpha: number;
  size: number;
  speed: number;
  phase: number;
}

function buildStars(W: number, H: number): Star[] {
  // Original tile is 200×100px. We tile it across the canvas.
  const tileW = 200;
  const tileH = 100;

  // The 5 star positions + colors from the original CSS
  const template: Omit<Star, 'x' | 'y' | 'phase'>[] = [
    { r: 232, g: 160, b: 191, baseAlpha: 0.30, size: 1.2, speed: 0.41 },
    { r: 167, g: 139, b: 250, baseAlpha: 0.20, size: 1.2, speed: 0.55 },
    { r: 232, g: 160, b: 191, baseAlpha: 0.40, size: 0.8, speed: 0.37 },
    { r: 251, g: 191, b: 126, baseAlpha: 0.20, size: 0.8, speed: 0.62 },
    { r: 232, g: 160, b: 191, baseAlpha: 0.20, size: 1.2, speed: 0.48 },
  ];
  const offsets = [
    { dx: 20, dy: 30 },
    { dx: 40, dy: 70 },
    { dx: 90, dy: 40 },
    { dx: 130, dy: 80 },
    { dx: 160, dy: 30 },
  ];

  const stars: Star[] = [];
  let phase = 0;
  for (let tx = 0; tx * tileW < W + tileW; tx++) {
    for (let ty = 0; ty * tileH < H + tileH; ty++) {
      for (let s = 0; s < 5; s++) {
        stars.push({
          x: tx * tileW + offsets[s].dx,
          y: ty * tileH + offsets[s].dy,
          ...template[s],
          phase: phase,
        });
        phase += 0.37; // stagger phases so stars don't all flicker together
      }
    }
  }
  return stars;
}

export default function SpaceBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef<number>(0);
  const starsRef  = useRef<Star[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      if (!canvas) return;
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
      starsRef.current = buildStars(canvas.width, canvas.height);
    };
    resize();
    window.addEventListener('resize', resize);

    let t = 0;

    function draw() {
      if (!ctx || !canvas) return;
      t += 0.016;

      // Pure #0f0a1a — matches navbar bg-cinema-bg exactly
      ctx.fillStyle = '#0f0a1a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw every star with its own flicker phase
      for (const s of starsRef.current) {
        const flicker = 0.5 + 0.5 * Math.sin(t * s.speed + s.phase);
        const alpha   = s.baseAlpha * (0.45 + 0.55 * flicker);
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${s.r},${s.g},${s.b},${alpha})`;
        ctx.fill();
      }

      rafRef.current = requestAnimationFrame(draw);
    }

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: -1,
      }}
    />
  );
}