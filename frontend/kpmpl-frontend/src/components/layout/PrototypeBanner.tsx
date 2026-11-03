import type { ReactNode } from 'react';
import { config } from '../../config';

/** Persistent demo disclosure: a thin ink strip at the very top. Hidden when APP_MODE=production. */
export function PrototypeBanner({ tools }: { tools?: ReactNode }) {
  if (!config.isDemo) return null;
  return (
    <div className="flex h-7 items-center justify-between gap-4 bg-ink px-4 font-mono text-[15px] leading-none text-paper md:px-8">
      <p className="min-w-0 truncate">
        <span>DEMO · sample data</span>
        {config.isMock
          ? <span className="hidden sm:inline"> · not linked to DataMan · data is kept in this tab only</span>
          : <span className="hidden sm:inline"> · demo server · synthetic data only · not linked to DataMan</span>}
        <span className="hidden lg:inline"> · use Sign out to switch user</span>
      </p>
      {tools}
    </div>
  );
}
