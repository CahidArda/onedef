// Building blocks shared by the diagrams: plain HTML and Tailwind on the fumadocs
// tokens, so every diagram follows the reader's theme and reflows at phone width.

import type { ReactNode } from 'react';
import { Dot, type Slot } from './dot';

export type Tone = 'muted' | 'info' | 'idea' | 'success' | 'error';

const toneText: Record<Tone, string> = {
  muted: 'text-fd-muted-foreground',
  info: 'text-fd-info',
  idea: 'text-fd-idea',
  success: 'text-fd-success',
  error: 'text-fd-error',
};

const toneLine: Record<Tone, string> = {
  muted: 'bg-fd-muted-foreground/30',
  info: 'bg-fd-info/40',
  idea: 'bg-fd-idea/40',
  success: 'bg-fd-success/40',
  error: 'bg-fd-error/40',
};

const toneChip: Record<Tone, string> = {
  muted: 'border-fd-border bg-fd-secondary text-fd-foreground',
  info: 'border-fd-info/30 bg-fd-info/10 text-fd-info',
  idea: 'border-fd-idea/30 bg-fd-idea/10 text-fd-idea',
  success: 'border-fd-success/30 bg-fd-success/10 text-fd-success',
  error: 'border-fd-error/30 bg-fd-error/10 text-fd-error',
};

export function cx(...names: (string | false | null | undefined)[]) {
  return names.filter(Boolean).join(' ');
}

/** The outer frame of a diagram. `bare` drops the frame for pages that supply their own. */
export function Figure({
  label,
  children,
  bare,
  className,
}: {
  label: string;
  children: ReactNode;
  bare?: boolean;
  className?: string;
}) {
  return (
    <figure
      role="img"
      aria-label={label}
      className={cx(
        '@container not-prose relative w-full min-w-0 text-sm',
        !bare && 'my-8 rounded-2xl border border-fd-border bg-fd-card p-4 sm:p-6',
        className,
      )}
    >
      {children}
    </figure>
  );
}

/** A node: a small card. */
export function Box({
  children,
  className,
  tone,
  dashed,
}: {
  children: ReactNode;
  className?: string;
  tone?: Tone;
  dashed?: boolean;
}) {
  return (
    <div
      className={cx(
        'relative z-10 min-w-0 rounded-xl border bg-fd-background px-3 py-2.5 shadow-sm',
        dashed && 'border-dashed shadow-none',
        tone && tone !== 'muted' ? toneChip[tone].split(' ')[0] : 'border-fd-border',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Code in a diagram: a mono chip, optionally tinted. */
export function Code({ children, tone, className }: { children: ReactNode; tone?: Tone; className?: string }) {
  return (
    <code
      className={cx(
        'inline-block max-w-full break-words rounded-md border px-1.5 py-0.5 font-mono leading-snug',
        // a size passed in className wins (cx does not merge conflicting classes)
        !className?.includes('text-[') && 'text-[11.5px]',
        toneChip[tone ?? 'muted'],
        className,
      )}
    >
      {children}
    </code>
  );
}

/** A small caption line, e.g. what a wire carries. */
export function Note({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx('text-xs leading-snug text-fd-muted-foreground', className)}>{children}</p>;
}

/** Small uppercase heading inside a diagram. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cx('text-[11px] font-semibold uppercase tracking-wider text-fd-muted-foreground', className)}>
      {children}
    </p>
  );
}

/**
 * Each diagram runs one pulse per `cycle` seconds. A wire's `at` is its slot in that
 * cycle, in seconds: chain the slots end to start and the dot travels box to box.
 */
export const CYCLE = 4;

type WireProps = {
  tone?: Tone;
  /** When the dot travels this wire, in seconds into the cycle. No slot, no dot. */
  at?: Slot;
  cycle?: number;
  reverse?: boolean;
  className?: string;
};

/** A vertical wire. */
export function VWire({ tone = 'muted', at, cycle = CYCLE, reverse, className, height = 'h-8' }: WireProps & { height?: string }) {
  return (
    <div aria-hidden className={cx('relative mx-auto w-px', height, toneLine[tone], className)}>
      {at && <Dot axis="v" at={at} cycle={cycle} reverse={reverse} className={toneText[tone]} />}
    </div>
  );
}

/** A horizontal wire. */
export function HWire({ tone = 'muted', at, cycle = CYCLE, reverse, className }: WireProps) {
  return (
    <div aria-hidden className={cx('relative my-auto h-px min-w-6 flex-1', toneLine[tone], className)}>
      {at && <Dot axis="h" at={at} cycle={cycle} reverse={reverse} className={toneText[tone]} />}
    </div>
  );
}

/**
 * The horizontal line columns hang from (or join into), split at its middle. `split`
 * sends a dot from the middle out to both ends; `merge` brings one in from each end.
 * Position it absolutely with `className` (it spans from the first to the last column's
 * centre); each half takes its own colour.
 */
export function Bus({
  left,
  right,
  at,
  cycle = CYCLE,
  mode = 'split',
  className,
}: {
  left: Tone;
  right: Tone;
  at?: Slot;
  cycle?: number;
  mode?: 'split' | 'merge';
  className?: string;
}) {
  return (
    <div aria-hidden className={cx('absolute flex h-px', className)}>
      <div className={cx('relative h-full flex-1', toneLine[left])}>
        {at && <Dot axis="h" at={at} cycle={cycle} reverse={mode === 'split'} className={toneText[left]} />}
      </div>
      <div className={cx('relative h-full flex-1', toneLine[right])}>
        {at && <Dot axis="h" at={at} cycle={cycle} reverse={mode === 'merge'} className={toneText[right]} />}
      </div>
    </div>
  );
}

/** Arrow head for the end of a wire. */
export function Arrow({ dir = 'down', tone = 'muted', className }: { dir?: 'down' | 'up' | 'left' | 'right'; tone?: Tone; className?: string }) {
  const rotate = { down: '', up: 'rotate-180', left: 'rotate-90', right: '-rotate-90' }[dir];
  return (
    <svg aria-hidden viewBox="0 0 10 6" className={cx('mx-auto h-1.5 w-2.5 shrink-0', rotate, toneText[tone], className)}>
      <path d="M0 0 L5 6 L10 0" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
