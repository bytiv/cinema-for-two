'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';
import { Postcard } from '@/types';
import PostcardModal from '@/components/postcards/PostcardModal';

// ─── Types ─────────────────────────────────────────────────────────────────
type Mode =
  | { kind: 'patrol' }                        // drifting along edges, no target
  | { kind: 'chase';  target: number }        // chasing another card
  | { kind: 'flee';   from: number }          // running away after being caught / chased
  | { kind: 'idle' }                          // brief pause on the edge

interface Card {
  x: number; y: number;
  vx: number; vy: number;
  mode: Mode;
  modeTimer: number;
  touchCooldown: number;
  lastTarget: number;
  lastFleefrom: number;
  phase: number;
  homeSide: 'left' | 'right';  // which side this card belongs to
  homeX: number;               // anchor x in pixels
}

interface TrailDot {
  x: number; y: number;
  life: number; maxLife: number;
  size: number;
  r: number; g: number; b: number;
  phase: number;
}

// ─── Palette ────────────────────────────────────────────────────────────────
const TRAIL_COLORS = [
  [232, 160, 191],
  [167, 139, 250],
  [251, 191, 126],
  [240, 230, 246],
] as const;

// ─── Tuning ─────────────────────────────────────────────────────────────────
const CHASE_SPEED   = 1.55;
const FLEE_SPEED    = 2.10;
const PATROL_SPEED  = 0.38;
const IDLE_SPEED    = 0.10;
const MOUSE_SLOW    = 0.15;
const MOUSE_R       = 110;

// Each card belongs to a "side" — left 50% or right 50%.
// Home anchor is in that side's strip. Center zone repels all cards.
// Cards CAN cross to the other side when chasing/fleeing, but drift back.
const SIDE_ANCHOR_PULL = 0.0012;  // gentle pull back to home side
const CENTER_REPEL_X   = 0.50;    // normalized x — center of screen
const CENTER_BAND      = 0.14;    // half-width of repel band around center
const CENTER_PUSH      = 0.018;
const EDGE_PAD         = 55;
const EDGE_PUSH        = 0.005;
const SEPARATION_R     = 110;     // px — cards push apart if too close (prevents clustering)
const SEPARATION_F     = 0.025;

const TOUCH_DIST   = 80;
const TOUCH_CD     = 120;

// ─── Helpers ─────────────────────────────────────────────────────────────────
function pickChaseTarget(i: number, n: number, exclude: number): number {
  if (n <= 1) return -1;
  let t = Math.floor(Math.random() * (n - 1));
  if (t >= i) t++;                     // skip self
  if (t === exclude) {                  // skip last target
    t = (t + 1) % n;
    if (t === i) t = (t + 1) % n;
  }
  return t;
}

function pickFleeFrom(i: number, n: number, from: number, excludePrev: number): number {
  // flee away from `from`, but we store it for the "no repeat" rule
  void i; void n; void excludePrev;
  return from;
}

function modeTimer(m: Mode): number {
  switch (m.kind) {
    case 'chase':  return 350 + Math.random() * 300;
    case 'flee':   return 80  + Math.random() * 60;
    case 'patrol': return 250 + Math.random() * 350;
    case 'idle':   return 60  + Math.random() * 80;
  }
}

// Spawn card on its home side (left or right strip), along the screen edge
function edgeSpawn(W: number, H: number, side: 'left' | 'right'): { x: number; y: number; vx: number; vy: number } {
  const spd = PATROL_SPEED * (0.8 + Math.random() * 0.4);
  const dir = Math.random() * Math.PI * 2;
  // Left side: x in 3%–22% of W. Right side: x in 78%–97% of W.
  const x = side === 'left'
    ? EDGE_PAD + Math.random() * (W * 0.19)
    : W - EDGE_PAD - Math.random() * (W * 0.19);
  const y = EDGE_PAD + Math.random() * (H - EDGE_PAD * 2);
  return { x, y, vx: Math.cos(dir) * spd, vy: Math.sin(dir) * spd };
}

// ─── Component ──────────────────────────────────────────────────────────────
export default function FloatingPostcards() {
  const [postcards, setPostcards] = useState<Postcard[]>([]);
  const [selected,  setSelected]  = useState<Postcard | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cardRefs  = useRef<(HTMLDivElement | null)[]>([]);
  const cardsRef  = useRef<Card[]>([]);
  const trailsRef = useRef<TrailDot[]>([]);
  const mouseRef  = useRef({ x: -9999, y: -9999, active: false });
  const rafRef    = useRef<number>(0);
  const supabase  = createClient();

  const brightSet = useMemo(() => {
    const arr = Array.from({ length: 10 }, (_, i) => i).sort(() => Math.random() - 0.5).slice(0, 3);
    return new Set(arr);
  }, []);

  // ── Fetch postcards ──────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        const { data } = await supabase.from('postcards').select('*').order('created_at').limit(10);
        if (data) setPostcards(data);
        return;
      }
      const { data: myProfile } = await supabase
        .from('profiles').select('postcards_disabled').eq('user_id', user.id).single();
      const [{ data: asReq }, { data: asAddr }] = await Promise.all([
        supabase.from('friendships').select('addressee_id').eq('requester_id', user.id).eq('status', 'accepted'),
        supabase.from('friendships').select('requester_id').eq('addressee_id', user.id).eq('status', 'accepted'),
      ]);
      const friendIds: string[] = [];
      asReq?.forEach(f => friendIds.push(f.addressee_id));
      asAddr?.forEach(f => friendIds.push(f.requester_id));
      let allowedIds: string[] = [];
      if (friendIds.length > 0) {
        const [{ data: theyShare }, { data: iShare }, { data: fProfiles }] = await Promise.all([
          supabase.from('postcard_shares').select('user_id').eq('friend_id', user.id).in('user_id', friendIds),
          supabase.from('postcard_shares').select('friend_id').eq('user_id', user.id).in('friend_id', friendIds),
          supabase.from('profiles').select('user_id, postcards_disabled').in('user_id', friendIds),
        ]);
        const theySet     = new Set((theyShare || []).map(r => r.user_id));
        const iSet        = new Set((iShare    || []).map(r => r.friend_id));
        const disabledSet = new Set((fProfiles || []).filter(p => p.postcards_disabled).map(p => p.user_id));
        allowedIds = friendIds.filter(id => theySet.has(id) && iSet.has(id) && !disabledSet.has(id));
      }
      const toFetch: string[] = [];
      if (!myProfile?.postcards_disabled) toFetch.push(user.id);
      toFetch.push(...allowedIds);
      if (!toFetch.length) return;
      const { data } = await supabase.from('postcards').select('*').in('user_id', toFetch).order('created_at').limit(10);
      if (data) setPostcards(data);
    }
    load();
  }, []);

  // ── Init cards on edge ────────────────────────────────────────────────────
  useEffect(() => {
    if (!postcards.length) return;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const n = postcards.length;
    cardsRef.current = postcards.map((_, i) => {
      // Alternate sides: even → left, odd → right
      const homeSide: 'left' | 'right' = i % 2 === 0 ? 'left' : 'right';
      const homeX = homeSide === 'left' ? W * 0.10 : W * 0.90;
      const spawn = edgeSpawn(W, H, homeSide);
      const mode: Mode = Math.random() < 0.5
        ? { kind: 'patrol' }
        : { kind: 'chase', target: pickChaseTarget(i, n, -1) };
      return {
        ...spawn,
        mode,
        modeTimer: modeTimer(mode),
        touchCooldown: Math.floor(Math.random() * 80),
        lastTarget: -1,
        lastFleefrom: -1,
        phase: Math.random() * Math.PI * 2,
        homeSide,
        homeX,
      };
    });
  }, [postcards]);

  // ── Mouse ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const mv = (e: MouseEvent) => { mouseRef.current = { x: e.clientX, y: e.clientY, active: true }; };
    const ml = () => { mouseRef.current.active = false; };
    window.addEventListener('mousemove', mv);
    window.addEventListener('mouseleave', ml);
    return () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseleave', ml); };
  }, []);

  // ── Main loop ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!postcards.length) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize();
    window.addEventListener('resize', resize);

    let frame = 0;

    function tick() {
      if (!ctx || !canvas) return;
      frame++;
      const W      = canvas.width;
      const H      = canvas.height;
      const cards  = cardsRef.current;
      const n      = cards.length;
      const mouse  = mouseRef.current;

      for (let i = 0; i < n; i++) {
        const c = cards[i];

        // ── Mode timer ──────────────────────────────────────────────────────
        c.modeTimer--;
        if (c.modeTimer <= 0) {
          // After chase expires → flee (chaser runs away)
          if (c.mode.kind === 'chase') {
            const prevTarget = c.mode.target;
            c.mode = { kind: 'flee', from: prevTarget };
            c.lastTarget = prevTarget;
          } else {
            // patrol / idle / flee → patrol or new chase
            const roll = Math.random();
            if (roll < 0.45 && n > 1) {
              const t = pickChaseTarget(i, n, c.lastTarget);
              c.mode = { kind: 'chase', target: t };
            } else if (roll < 0.60) {
              c.mode = { kind: 'idle' };
            } else {
              c.mode = { kind: 'patrol' };
            }
          }
          c.modeTimer = modeTimer(c.mode);
        }
        if (c.touchCooldown > 0) c.touchCooldown--;

        // ── Touch detection ─────────────────────────────────────────────────
        // When chaser catches its target: chaser flees, target also flees
        if (c.mode.kind === 'chase' && c.touchCooldown === 0) {
          const t = cards[c.mode.target];
          const dx = t.x - c.x, dy = t.y - c.y;
          if (Math.sqrt(dx * dx + dy * dy) < TOUCH_DIST && t.touchCooldown === 0) {
            const prevTarget = c.mode.target;

            // Chaser: flee away from the target it just caught
            c.mode = { kind: 'flee', from: prevTarget };
            c.modeTimer = modeTimer(c.mode);
            c.lastTarget = prevTarget;
            c.touchCooldown = TOUCH_CD;

            // Target: flee away from the chaser (can't flee from same source twice in a row)
            const fleeFrom = pickFleeFrom(prevTarget, n, i, t.lastFleefrom);
            t.mode = { kind: 'flee', from: fleeFrom };
            t.modeTimer = modeTimer(t.mode);
            t.lastFleefrom = fleeFrom;
            t.touchCooldown = TOUCH_CD;
          }
        }

        // ── Steering ─────────────────────────────────────────────────────────
        let ax = 0, ay = 0;

        if (c.mode.kind === 'chase') {
          const t  = cards[c.mode.target];
          const dx = t.x - c.x, dy = t.y - c.y;
          const d  = Math.sqrt(dx * dx + dy * dy) || 1;
          ax += (dx / d) * 0.055;
          ay += (dy / d) * 0.055;
          ax += (t.vx - c.vx) * 0.04;
          ay += (t.vy - c.vy) * 0.04;

        } else if (c.mode.kind === 'flee') {
          const t  = cards[c.mode.from];
          if (t) {
            const dx = c.x - t.x, dy = c.y - t.y;
            const d  = Math.sqrt(dx * dx + dy * dy) || 1;
            ax += (dx / d) * 0.10;
            ay += (dy / d) * 0.10;
          }

        } else {
          // patrol / idle: gentle wander along edges
          const w = c.mode.kind === 'idle' ? 0.012 : 0.025;
          ax += (Math.random() - 0.5) * w;
          ay += (Math.random() - 0.5) * w;
        }

        // ── Pull toward home side + repel from center band ───────────────────
        const cx = c.x / W;
        // Soft pull back toward home side anchor x
        ax -= (c.x - c.homeX) * SIDE_ANCHOR_PULL;
        // Repel from center band so cards stay on their side strips
        const distFromCenter = cx - CENTER_REPEL_X;
        if (Math.abs(distFromCenter) < CENTER_BAND) {
          ax += (distFromCenter < 0 ? -1 : 1) * CENTER_PUSH * (1 - Math.abs(distFromCenter) / CENTER_BAND);
        }

        // ── Separation — prevent clustering ──────────────────────────────────
        for (let j = 0; j < n; j++) {
          if (j === i) continue;
          const o = cards[j];
          const sdx = c.x - o.x, sdy = c.y - o.y;
          const sd = Math.sqrt(sdx * sdx + sdy * sdy);
          if (sd < SEPARATION_R && sd > 0) {
            ax += (sdx / sd) * SEPARATION_F * (1 - sd / SEPARATION_R);
            ay += (sdy / sd) * SEPARATION_F * (1 - sd / SEPARATION_R);
          }
        }

        // ── Soft viewport edge bounce ─────────────────────────────────────────
        if (c.x < EDGE_PAD)       ax +=  (EDGE_PAD - c.x)       * EDGE_PUSH;
        if (c.x > W - EDGE_PAD)   ax -= (c.x - (W - EDGE_PAD))  * EDGE_PUSH;
        if (c.y < EDGE_PAD)       ay +=  (EDGE_PAD - c.y)       * EDGE_PUSH;
        if (c.y > H - EDGE_PAD)   ay -= (c.y - (H - EDGE_PAD))  * EDGE_PUSH;

        // ── Mouse slow-down ───────────────────────────────────────────────────
        const mdx = mouse.x - c.x, mdy = mouse.y - c.y;
        const md  = Math.sqrt(mdx * mdx + mdy * mdy);
        const nearMouse = mouse.active && md < MOUSE_R;
        if (nearMouse) {
          const drag = 1 - (1 - md / MOUSE_R) * 0.09;
          c.vx *= drag; c.vy *= drag;
        }

        // ── Integrate ─────────────────────────────────────────────────────────
        c.vx += ax; c.vy += ay;
        const spd    = Math.sqrt(c.vx * c.vx + c.vy * c.vy);
        const maxSpd = nearMouse ? MOUSE_SLOW
          : c.mode.kind === 'flee'   ? FLEE_SPEED
          : c.mode.kind === 'chase'  ? CHASE_SPEED
          : c.mode.kind === 'idle'   ? IDLE_SPEED
          : PATROL_SPEED;
        const minSpd = c.mode.kind === 'idle' ? 0 : 0.10;
        if (spd > maxSpd && spd > 0) { c.vx = (c.vx / spd) * maxSpd; c.vy = (c.vy / spd) * maxSpd; }
        if (spd < minSpd && spd > 0) { c.vx = (c.vx / spd) * minSpd; c.vy = (c.vy / spd) * minSpd; }

        c.x += c.vx; c.y += c.vy;

        // ── Apply to DOM ───────────────────────────────────────────────────────
        const el = cardRefs.current[i];
        if (el) {
          const tilt = Math.max(-6, Math.min(6, c.vx * 3));
          el.style.left      = `${c.x}px`;
          el.style.top       = `${c.y}px`;
          el.style.transform = `translate(-50%,-50%) rotate(${tilt}deg)`;
        }

        // ── Trail star spawn — offset BEHIND the card along its velocity ───
        if (frame % 4 === i % 4 && spd > 0.2) {
          const col = TRAIL_COLORS[Math.floor(Math.random() * TRAIL_COLORS.length)];
          // Spawn behind the card: position = card center minus normalised velocity * trail distance
          const trailDist = 12 + Math.random() * 8;
          const nx = spd > 0 ? c.vx / spd : 0;
          const ny = spd > 0 ? c.vy / spd : 0;
          trailsRef.current.push({
            x: c.x - nx * trailDist + (Math.random() - 0.5) * 6,
            y: c.y - ny * trailDist + (Math.random() - 0.5) * 6,
            life: 0,
            maxLife: 45 + Math.random() * 55,
            size: 0.5 + Math.random() * 1.0,
            r: col[0], g: col[1], b: col[2],
            phase: c.phase + Math.random() * 0.8,
          });
        }
      }

      // ── Canvas trail draw — NO fillRect fade so stars aren't erased ────────
      // Instead we age each dot's alpha directly; old dots just disappear.
      ctx.clearRect(0, 0, W, H);

      const alive: TrailDot[] = [];
      for (const dot of trailsRef.current) {
        dot.life++;
        if (dot.life >= dot.maxLife) continue;
        alive.push(dot);
        const t       = dot.life / dot.maxLife;
        const flicker = 0.65 + 0.35 * Math.sin(frame * 0.18 + dot.phase);
        const alpha   = (1 - t) * 0.75 * flicker;
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, dot.size * (1 - t * 0.55), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${dot.r},${dot.g},${dot.b},${alpha})`;
        ctx.fill();
      }
      trailsRef.current = alive.length < 500 ? alive : alive.slice(-400);

      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(rafRef.current); window.removeEventListener('resize', resize); };
  }, [postcards]);

  if (!postcards.length) return null;

  return (
    <>
      {/* Trail canvas — z-index 1, above SpaceBackground(-1), below postcards(2) */}
      <canvas ref={canvasRef} id="trail-canvas" />
      {/* Postcards — z-index 2, above trail canvas so trail appears BEHIND them */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 2 }}>
        {postcards.map((pc, i) => {
          const big = brightSet.has(i);
          return (
            <div
              key={pc.id}
              ref={el => { cardRefs.current[i] = el; }}
              className={`postcard-swim pointer-events-auto ${big ? 'postcard-bright' : 'postcard-dim'}`}
              style={{ left: '50%', top: '50%', transform: 'translate(-50%,-50%)' }}
              onClick={() => setSelected(pc)}
            >
              <div
                style={{ width: big ? 120 : 88, height: big ? 144 : 106 }}
                className="relative rounded-lg overflow-hidden shadow-xl border border-white/10"
              >
                <Image src={pc.image_url} alt={pc.caption || 'Memory'} fill className="object-cover" sizes="150px" />
              </div>
            </div>
          );
        })}
      </div>
      {selected && <PostcardModal postcard={selected} onClose={() => setSelected(null)} />}
    </>
  );
}