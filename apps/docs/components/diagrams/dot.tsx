'use client';

// A dot that travels one wire during its slot of a diagram-wide cycle. Every wire in a
// diagram shares the cycle and the slots chain end to start, so one pulse appears to
// travel box to box: down a wire, through a box, out of the next wire, splitting where
// a line forks. All dots are pinned to the document timeline, so they stay in phase.

import { useEffect, useRef } from 'react';

export type Slot = readonly [start: number, end: number];

export function Dot({
  axis,
  at,
  cycle,
  reverse,
  className,
}: {
  axis: 'v' | 'h';
  at: Slot;
  cycle: number;
  reverse?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [start, end] = at;

  useEffect(() => {
    const el = ref.current;
    if (!el || !el.animate) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const prop = axis === 'v' ? 'top' : 'left';
    const pos = (t: number) => `calc(${(reverse ? 1 - t : t) * 100}% - 3px)`;
    const s = Math.max(0, Math.min(1, start / cycle));
    const e = Math.max(s, Math.min(1, end / cycle));
    const edge = Math.min(0.004, (e - s) / 4);

    const animation = el.animate(
      [
        { offset: 0, [prop]: pos(0), opacity: 0 },
        { offset: s, [prop]: pos(0), opacity: 0 },
        { offset: s + edge, [prop]: pos(edge / (e - s || 1)), opacity: 1 },
        { offset: e - edge, [prop]: pos(1 - edge / (e - s || 1)), opacity: 1 },
        { offset: e, [prop]: pos(1), opacity: 0 },
        { offset: 1, [prop]: pos(1), opacity: 0 },
      ],
      { duration: cycle * 1000, iterations: Infinity, easing: 'linear' },
    );
    // Same phase for every dot on the page, whenever it mounted.
    animation.startTime = 0;
    return () => animation.cancel();
  }, [axis, start, end, cycle, reverse]);

  return (
    <span
      ref={ref}
      className={className}
      style={{
        position: 'absolute',
        width: 6,
        height: 6,
        borderRadius: 9999,
        background: 'currentColor',
        opacity: 0,
        ...(axis === 'v' ? { left: 'calc(50% - 3px)', top: -3 } : { top: 'calc(50% - 3px)', left: -3 }),
      }}
    />
  );
}
