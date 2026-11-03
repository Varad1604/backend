import { cn } from './cn';

/** Text filters with counts in mono: "All 12   Waiting 3". Active one is ink, underlined. */
export function Tabs<K extends string>({ items, active, onSelect, label, className }: {
  items: { key: K; label: string; count?: number | null }[]; active: K; onSelect: (k: K) => void; label?: string; className?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={cn('-mb-px flex gap-x-6 overflow-x-auto', className)}>
      {items.map((t) => {
        const on = t.key === active;
        return (
          <button key={t.key} role="tab" type="button" aria-selected={on} onClick={() => onSelect(t.key)}
            className={cn('inline-flex min-h-10 shrink-0 items-baseline gap-1.5 whitespace-nowrap border-b-2 pt-2.5 pb-2 text-[16px] transition-colors',
              on ? 'border-ink font-medium text-ink' : 'border-transparent text-muted hover:text-ink')}>
            {t.label}
            {t.count !== undefined && (
              <>
                <span className="sr-only"> </span>
                <span className={cn('font-mono text-[15px]', on ? 'text-ink' : 'text-muted')}>{t.count ?? '…'}</span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
