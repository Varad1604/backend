import { useBlocker } from 'react-router-dom';
import { ConfirmDialog } from './ConfirmDialog';

/** In-app "leave without saving?" prompt (no window.confirm, which embedded previews block). */
export function UnsavedChangesGuard({ when, message }: { when: boolean; message: string }) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => when && currentLocation.pathname !== nextLocation.pathname);
  return (
    <ConfirmDialog open={blocker.state === 'blocked'} title="Leave without saving?" confirmLabel="Leave without saving"
      onCancel={() => blocker.reset?.()} onConfirm={() => blocker.proceed?.()}>
      {message}
    </ConfirmDialog>
  );
}
