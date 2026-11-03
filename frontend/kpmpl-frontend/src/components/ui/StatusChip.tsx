import type { ReactNode } from 'react';
import { cn } from './cn';
import type { Tone } from '../../domain/status';

/**
 * The ONE status colour mapping for the whole app.
 *   done    green  — finished / accepted
 *   waiting amber  — waiting on someone else
 *   problem red    — problem / rejected / returned
 *   action  blue   — needs YOUR action
 *   neutral grey   — informational
 */
export type UiTone = 'done' | 'waiting' | 'problem' | 'action' | 'neutral';

/** Domain tones (status.ts) folded onto the UI tones. */
export const toUiTone: Record<Tone, UiTone> = {
  success: 'done', warning: 'waiting', progress: 'waiting', danger: 'problem', info: 'action', neutral: 'neutral',
};

export const toneClasses: Record<UiTone, { chip: string; accent: string; dot: string }> = {
  done: { chip: 'bg-done-bg text-done border-done-line', accent: 'border-l-done', dot: 'bg-done' },
  waiting: { chip: 'bg-wait-bg text-wait border-wait-line', accent: 'border-l-wait', dot: 'bg-wait' },
  problem: { chip: 'bg-problem-bg text-problem border-problem-line', accent: 'border-l-problem', dot: 'bg-problem' },
  action: { chip: 'bg-action-bg text-action border-action-line', accent: 'border-l-action', dot: 'bg-action' },
  neutral: { chip: 'bg-neutral-bg text-neutral border-neutral-line', accent: 'border-l-field', dot: 'bg-field' },
};

export function StatusChip({ tone, children, className, size = 'md' }: { tone: UiTone; children: ReactNode; className?: string; size?: 'sm' | 'md' }) {
  const t = toneClasses[tone];
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border font-semibold',
      size === 'sm' ? 'px-2.5 py-0.5 text-[14px]' : 'px-3 py-1 text-[15px]', t.chip, className)}>
      <span aria-hidden className={cn('size-2 shrink-0 rounded-full', t.dot)} />
      {children}
    </span>
  );
}
