'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';
import { Postcard } from '@/types';
import PostcardModal from '@/components/postcards/PostcardModal';

const FLOAT_CONFIGS = [
  { top: '10%', left: '5%',   duration: '22s', delay: '0s',   rotateStart: '-5deg', rotateMid: '3deg',  rotateEnd: '1deg',  driftX: '20px',  driftY: '-25px' },
  { top: '20%', right: '8%',  duration: '18s', delay: '2s',   rotateStart: '4deg',  rotateMid: '-2deg', rotateEnd: '3deg',  driftX: '-15px', driftY: '-20px' },
  { top: '55%', left: '3%',   duration: '25s', delay: '5s',   rotateStart: '-3deg', rotateMid: '4deg',  rotateEnd: '-1deg', driftX: '18px',  driftY: '-30px' },
  { top: '60%', right: '5%',  duration: '20s', delay: '1s',   rotateStart: '6deg',  rotateMid: '-3deg', rotateEnd: '2deg',  driftX: '-22px', driftY: '-15px' },
  { top: '35%', left: '85%',  duration: '23s', delay: '3s',   rotateStart: '-2deg', rotateMid: '5deg',  rotateEnd: '-3deg', driftX: '12px',  driftY: '-28px' },
  { top: '75%', left: '10%',  duration: '19s', delay: '4s',   rotateStart: '3deg',  rotateMid: '-4deg', rotateEnd: '1deg',  driftX: '-16px', driftY: '-22px' },
  { top: '15%', left: '45%',  duration: '21s', delay: '6s',   rotateStart: '-4deg', rotateMid: '2deg',  rotateEnd: '-2deg', driftX: '25px',  driftY: '-18px' },
  { top: '80%', right: '15%', duration: '24s', delay: '2.5s', rotateStart: '2deg',  rotateMid: '-5deg', rotateEnd: '4deg',  driftX: '-20px', driftY: '-35px' },
  { top: '45%', left: '50%',  duration: '17s', delay: '7s',   rotateStart: '-6deg', rotateMid: '3deg',  rotateEnd: '-1deg', driftX: '14px',  driftY: '-24px' },
  { top: '30%', left: '20%',  duration: '26s', delay: '1.5s', rotateStart: '5deg',  rotateMid: '-2deg', rotateEnd: '3deg',  driftX: '-18px', driftY: '-20px' },
];

export default function FloatingPostcards() {
  const [postcards, setPostcards] = useState<Postcard[]>([]);
  const [selected, setSelected] = useState<Postcard | null>(null);
  const supabase = createClient();

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

  if (!postcards.length) return null;

  return (
    <>
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        {postcards.map((postcard, idx) => {
          const config = FLOAT_CONFIGS[idx % FLOAT_CONFIGS.length];
          return (
            <div
              key={postcard.id}
              className="absolute postcard-float soft-focus pointer-events-auto cursor-pointer"
              style={{
                top: config.top,
                left: (config as any).left,
                right: (config as any).right,
                '--float-duration': config.duration,
                '--float-delay': config.delay,
                '--rotate-start': config.rotateStart,
                '--rotate-mid': config.rotateMid,
                '--rotate-end': config.rotateEnd,
                '--drift-x': config.driftX,
                '--drift-y': config.driftY,
                animationDelay: config.delay,
              } as React.CSSProperties}
              onClick={() => setSelected(postcard)}
            >
              <div className="relative w-24 h-28 sm:w-28 sm:h-32 rounded-lg overflow-hidden shadow-xl shadow-cinema-bg/50 border-2 border-white/10 bg-white/5 backdrop-blur-sm hover:scale-110 hover:shadow-2xl transition-transform duration-300">
                <Image
                  src={postcard.image_url}
                  alt={postcard.caption || 'Memory'}
                  fill
                  className="object-cover"
                  sizes="120px"
                />
              </div>
            </div>
          );
        })}
      </div>

      {selected && <PostcardModal postcard={selected} onClose={() => setSelected(null)} />}
    </>
  );
}