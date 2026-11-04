/** Standard error envelope (brief §3; 06 §4). Codes match the backend brief's table exactly. */
export type ApiErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'DUPLICATE_CANDIDATE'
  | 'VERSION_CONFLICT'
  | 'CONFLICT'
  | 'DOMAIN_RULE'
  | 'NETWORK_UNAVAILABLE'
  | 'SERVER_ERROR';

export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly httpStatus: number,
    public readonly fields: Record<string, string> = {},
    public readonly requestId?: string,
    public readonly meta: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  return new ApiError('SERVER_ERROR', 'Something went wrong. Nothing was saved.', 500);
}

/** User-facing wording kept consistent across screens (05 §5). */
export function describeError(e: ApiError): { title: string; body: string } {
  switch (e.code) {
    case 'NETWORK_UNAVAILABLE':
      if (e.meta.timeout) return { title: 'No answer from the server', body: 'The server did not answer in time. Your entries are still on this screen. Try again: repeating the same save is safe.' };
      return { title: 'Not saved — no connection', body: 'The server could not be reached. Your entries are still on this screen. Check the connection and try again.' };
    case 'FORBIDDEN':
      return { title: 'Not permitted', body: e.message || 'Your account does not have permission for this action.' };
    case 'UNAUTHENTICATED':
      return { title: 'Signed out', body: 'Your session has ended. Please sign in again.' };
    case 'NOT_FOUND':
      return { title: 'Record not found', body: 'This record does not exist or you do not have access to it.' };
    case 'VALIDATION_FAILED':
      return { title: 'Please check the highlighted fields', body: e.message };
    case 'DUPLICATE_CANDIDATE':
      return { title: 'Possible duplicate', body: e.message };
    case 'VERSION_CONFLICT':
      return { title: 'Updated by someone else', body: 'This record changed since you opened it. Reload to see the latest version before saving.' };
    case 'CONFLICT':
      return { title: 'That change conflicts with something already saved', body: e.message || 'Reload and try again.' };
    default:
      return { title: 'Not saved', body: e.message || 'An unexpected error occurred. Nothing was saved.' };
  }
}
