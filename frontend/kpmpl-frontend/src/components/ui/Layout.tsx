import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from './cn';

/**
 * Page head: muted breadcrumb, a 28px title (mono when it is a reference number),
 * statuses as one line of coloured text, and the page's actions at the top right
 * (text links first, the one solid ink button last).
 */
export function PageHeader({ title, description, actions, crumbs, status, mono }: {
  title: ReactNode; description?: ReactNode; actions?: ReactNode; crumbs?: { label: string; to?: string }[]; status?: ReactNode; mono?: boolean;
}) {
  return (
    <header className="mb-9">
      {crumbs && (
        <nav aria-label="Breadcrumb" className="mb-2 text-[15px] text-muted">
          {crumbs.map((c, i) => (
            <span key={i}>
              {c.to ? <Link to={c.to} className="text-muted underline-offset-[3px] hover:text-ink hover:underline">{c.label}</Link> : <span>{c.label}</span>}
              {i < crumbs.length - 1 && <span className="mx-2 text-field" aria-hidden>/</span>}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-8">
        <div className="min-w-0">
          <h1 className={cn('break-words text-[28px] font-semibold leading-[1.15] tracking-[-0.01em] text-ink', mono && 'font-mono font-medium tracking-[-0.02em]')}>{title}</h1>
          {status && <div className="mt-2">{status}</div>}
          {description && <p className="mt-2 max-w-2xl text-[16px] text-muted">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2 md:pt-px">{actions}</div>}
      </div>
    </header>
  );
}

/** Small-caps section heading. */
export function SectionHeading({ children, id, className }: { children: ReactNode; id?: string; className?: string }) {
  return <h2 id={id} className={cn('kicker', className)}>{children}</h2>;
}

/**
 * An unboxed section: small-caps heading, optional note and text actions on the right,
 * then the content. Tables, ruled lists and definition lists draw their own rules.
 */
export function Section({ children, className, title, subtitle, actions, as: As = 'section' }: {
  children: ReactNode; className?: string; title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; as?: 'section' | 'div';
}) {
  const head = title || actions || subtitle;
  return (
    <As className={cn('relative min-w-0', className)}>
      {head && (
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
            {title && <h2 className="kicker">{title}</h2>}
            {subtitle && <p className="text-[15px] text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[15px]">{actions}</div>}
        </div>
      )}
      {children}
    </As>
  );
}

/** Previous name for Section; every call site now renders unboxed. */
export const Card = Section;

/** Container class for a list of ReadOnlyItem rows (two columns: label, value). */
export const kvGrid = 'deflist';

/** Definition row: muted label on the left (160px), value on the right. */
export function ReadOnlyItem({ label, value, mono, source }: { label: string; value: ReactNode; mono?: boolean; source?: string }) {
  return (
    <div>
      <dt className="text-[15px] text-muted">{label}</dt>
      <dd className={cn('min-w-0 break-words text-[16px] text-ink', mono && 'font-mono')}>
        {value ?? '—'}
        {source && <span className="ml-2 font-sans text-[16px] italic text-muted">{source}</span>}
      </dd>
    </div>
  );
}

/** Horizontal scroll wrapper for tables on small screens. */
export function TableWrap({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('relative overflow-x-auto', className)}>{children}</div>;
}

/** Plain text action used in toolbars (e.g. Refresh). */
export function TextButton({ onClick, children, className }: { onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button type="button" onClick={onClick} className={cn('act min-h-10 text-[15px] sm:min-h-0', className)}>
      {children}
    </button>
  );
}

/** "Open →" text link. */
export function ViewLink({ to, children = 'Open', className, label }: { to: string; children?: ReactNode; className?: string; label?: string }) {
  return (
    <Link to={to} aria-label={label} className={cn('act inline-flex min-h-10 items-center text-[15px] sm:min-h-0', className)}>
      {children}<span aria-hidden className="ml-1 inline-block">→</span>
    </Link>
  );
}

/** Filters on the left, search and record count on the right, a hairline under both. */
export function ListToolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mb-5 flex flex-col gap-3 border-b border-rule lg:flex-row lg:items-end lg:justify-between lg:gap-8', className)}>{children}</div>;
}

/** A list area. No box. */
export function ListCard({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('relative', className)}>{children}</div>;
}

export interface TodoItem { key: string; count?: number; text: ReactNode; to?: string; linkLabel?: string }

/**
 * "To do": orange count, a short instruction in ink, "Open →" on the right.
 * Orange is used only here and in the summary, for work waiting on this person.
 */
export function TodoList({ items, empty = 'Nothing waiting on you.' }: { items: TodoItem[]; empty?: string }) {
  if (!items.length) return <p className="border-y border-rule py-4 text-[16px] text-muted">{empty}</p>;
  return (
    <ul className="border-t border-rule">
      {items.map((i) => (
        <li key={i.key} className="grid min-h-11 grid-cols-[40px_minmax(0,1fr)_auto] items-baseline gap-x-3 border-b border-rule py-2.5 sm:grid-cols-[56px_minmax(0,1fr)_auto]">
          <span className="font-mono text-[15px] font-medium text-signal">{i.count ?? 1}</span>
          <span className="text-[16px] text-ink">{i.text}</span>
          {i.to ? <ViewLink to={i.to} label={i.linkLabel} /> : <span />}
        </li>
      ))}
    </ul>
  );
}

/** A count inside a summary sentence: mono, underlined link to the filtered list. */
export function CountLink({ n, to, signal, children }: { n: number | string; to?: string; signal?: boolean; children: ReactNode }) {
  const num = <span className={cn('font-mono font-medium', signal && Number(n) > 0 && 'text-signal')}>{n}</span>;
  if (!to) return <span>{num} {children}</span>;
  return (
    <Link to={to} className="underline decoration-field decoration-1 underline-offset-[5px] hover:decoration-ink">
      {num} {children}
    </Link>
  );
}

/** Form footer: solid Save first, then the Cancel link, left-aligned. Sticks to the bottom on phones. */
export function FormFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('sticky bottom-0 z-10 -mx-4 flex flex-col-reverse gap-2 border-t border-rule bg-paper px-4 py-3',
      'sm:static sm:mx-0 sm:flex-row-reverse sm:items-center sm:justify-end sm:gap-6 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0', className)}>
      {children}
    </div>
  );
}

/** Form group titled with the small-caps heading; fields in two columns on desktop. */
export function FieldSet({ legend, children, className, cols = 2 }: { legend: string; children: ReactNode; className?: string; cols?: 1 | 2 }) {
  return (
    <fieldset className={cn('min-w-0', className)}>
      <legend className="kicker mb-4 w-full border-b border-rule pb-2">{legend}</legend>
      <div className={cn('grid gap-x-6 gap-y-5', cols === 2 && 'sm:grid-cols-2')}>{children}</div>
    </fieldset>
  );
}
