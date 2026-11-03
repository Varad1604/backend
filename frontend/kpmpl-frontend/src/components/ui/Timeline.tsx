import type { TimelineEvent } from '../../domain/types';
import { formatDateTime } from '../../lib/format';

/** History as a plain ruled list, time in mono on the left. */
export function Timeline({ events }: { events: TimelineEvent[] }) {
  if (!events.length) return <p className="text-[16px] text-muted">Nothing recorded yet.</p>;
  return (
    <ol className="@container border-t border-rule text-[15px]">
      {events.map((e) => (
        <li key={e.id} className="border-b border-rule py-2.5 @[520px]:grid @[520px]:grid-cols-[190px_minmax(0,1fr)] @[520px]:gap-4">
          <p className="pt-px font-mono text-[15px] text-muted">{formatDateTime(e.at)}</p>
          <div className="min-w-0">
          <p className="mt-0.5 font-medium text-ink @[520px]:mt-0">{e.action}</p>
          {e.detail && <p className="mt-0.5 text-ink-soft">{e.detail}</p>}
          <p className="mt-0.5 text-[16px] text-muted">
            {e.actor}
            {e.source === 'manual_staff_confirmation' && ' · entered by staff, not from ERP'}
          </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
