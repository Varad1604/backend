import { describeError, type ApiError } from '../../api';
import { Alert } from './States';
import { Button } from './Button';

/** Consistent "not saved" message for any failed write (never a false success). */
export function WriteError({ error, onReload, className }: { error: ApiError | null; onReload?: () => void; className?: string }) {
  if (!error) return null;
  const d = describeError(error);
  const fieldMsgs = error.code === 'VALIDATION_FAILED' ? Object.values(error.fields) : [];
  return (
    <Alert tone="danger" title={d.title} className={className}>
      {error.code === 'VALIDATION_FAILED' ? (fieldMsgs.length ? fieldMsgs.map((m, i) => <p key={i}>{m}</p>) : <p>{error.message}</p>) : <p>{d.body}</p>}
      {error.code === 'NETWORK_UNAVAILABLE' && (error.meta.timeout
        ? <p className="mt-1">It may or may not have been saved. Your entries are still here. Try again: repeating it will not save it twice.</p>
        : <p className="mt-1">Nothing was saved. Your entries are still here. Try again.</p>)}
      {error.code === 'VERSION_CONFLICT' && onReload && <Button variant="ghost" size="sm" className="mt-1" onClick={onReload}>Reload latest</Button>}
      {error.requestId && <p className="mt-1 font-mono text-[15px] text-muted">Ref. {error.requestId}</p>}
    </Alert>
  );
}
