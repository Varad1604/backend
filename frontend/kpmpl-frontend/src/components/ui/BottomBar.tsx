import type { ReactNode } from 'react';
import { cn } from '../ui/cn';

export interface BottomBarProps {
  left: ReactNode;
  right: ReactNode;
  className?: string;
}

export function BottomBar({ left, right, className }: BottomBarProps) {
  return (
    <div className={cn('sticky bottom-0 flex flex-wrap items-center gap-3 rounded-2xl border-t border-rule bg-surface px-5 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-lg sm:flex-nowrap sm:px-6 sm:py-4 sm:pb-[calc(1rem+env(safe-area-inset-bottom))]', className)}>
      {left && <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3 text-[16px] text-muted">{left}</div>}
      {right && <div className="flex shrink-0 items-center gap-3">{right}</div>}
    </div>
  );
}
