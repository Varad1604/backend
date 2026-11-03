import { cn } from '../ui/cn';

/** Wordmark: KPMPL | Gate to Bill. `inverse` for the dark header. */
export function Wordmark({ className, large, inverse }: { className?: string; large?: boolean; inverse?: boolean }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-2.5 whitespace-nowrap', inverse ? 'text-white' : 'text-ink', large ? 'text-[20px]' : 'text-[17px]', className)}>
      <span className={cn('rounded-md px-1.5 py-0.5 font-mono font-semibold tracking-[0.02em]', inverse ? 'bg-white text-brand-900' : 'bg-brand-700 text-white')}>KPMPL</span>
      <span className="hidden font-medium sm:inline">Gate to Bill</span>
    </span>
  );
}

/** Previous name. */
export const BrandMark = Wordmark;
