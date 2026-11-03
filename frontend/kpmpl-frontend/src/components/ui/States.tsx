import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';
import { Button } from './Button';
import { describeError, type ApiError } from '../../api';
import { cn } from './cn';

export function LoadingState({ label = 'Loading…', className }: { label?: string; className?: string }) {
  return <p role="status" aria-live="polite" className={cn('py-6 text-[16px] text-muted', className)}>{label}</p>;
}

/** One muted line and, at most, one text-link action. */
export function EmptyState({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-field bg-surface px-6 py-10 text-center">
      <Inbox aria-hidden size={32} strokeWidth={1.5} className="text-faint" />
      <p className="text-[17px] font-medium text-ink-soft">{title}</p>
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  const d = describeError(error);
  if (error.code === 'FORBIDDEN') return <ForbiddenState body={d.body} inline />;
  const offline = error.code === 'NETWORK_UNAVAILABLE';
  return (
    <div role="alert" className="py-6 text-[16px]">
      <p className="font-medium text-problem">{offline ? 'Could not load. No connection.' : 'Could not load this.'}</p>
      <p className="mt-0.5 text-muted">{offline ? 'Check the connection and try again.' : d.body}</p>
      {error.requestId && <p className="mt-0.5 font-mono text-[15px] text-muted">Ref. {error.requestId}</p>}
      {onRetry && <Button variant="ghost" size="sm" className="mt-1" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export function ForbiddenState({ body, inline }: { body?: string; inline?: boolean }) {
  const H = inline ? 'p' : 'h1';
  return (
    <div role="alert" className={inline ? 'py-6 text-[16px]' : 'py-10 text-[16px]'}>
      <H className={inline ? 'font-medium text-ink' : 'text-[28px] font-semibold leading-tight tracking-[-0.01em] text-ink'}>You do not have access to this page</H>
      <p className="mt-2 max-w-xl text-muted">{body ?? 'Your role does not include this. Ask the administrator if you need it.'}</p>
    </div>
  );
}

type AlertTone = 'info' | 'success' | 'warning' | 'danger';
const alertCls: Record<AlertTone, string> = {
  info: 'border-action bg-action-bg text-ink [&_.alert-title]:text-action',
  success: 'border-done bg-done-bg text-ink [&_.alert-title]:text-done',
  warning: 'border-wait bg-wait-bg text-ink [&_.alert-title]:text-wait',
  danger: 'border-problem bg-problem-bg text-ink [&_.alert-title]:text-problem',
};

/** Message line with a 2px coloured rule on the left. No fill, no box. */
export function Alert({ tone, title, children, className, role }: { tone: AlertTone; title?: ReactNode; children?: ReactNode; className?: string; role?: 'alert' | 'status' }) {
  return (
    <div role={role ?? (tone === 'danger' ? 'alert' : 'status')} className={cn('rounded-lg border-l-4 px-4 py-3 text-[16px]', alertCls[tone], className)}>
      {title && <p className="alert-title font-semibold">{title}</p>}
      {children && <div className={title ? 'mt-0.5' : ''}>{children}</div>}
    </div>
  );
}

/** "Note — …": italic, muted. Used for rules KPMPL has not confirmed yet. */
export function Note({ children, className }: { children: ReactNode; className?: string }) {
  return <p role="note" className={cn('text-[15px] italic text-muted', className)}><span className="not-italic">Note — </span>{children}</p>;
}

/** Kept for existing call sites; renders as a Note. */
export function InfoCallout({ children, className }: { children: ReactNode; className?: string }) {
  return <Note className={className}>{children}</Note>;
}

export function PendingRuleBadge({ children = 'pending KPMPL confirmation' }: { children?: ReactNode }) {
  return <span className="text-[16px] font-normal italic text-muted">{children}</span>;
}
