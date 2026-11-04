/**
 * Real-backend adapter. Contract: KPMPL_Backend_Build_Brief.md §3 (conventions) and §5
 * (endpoints). The README has the full endpoint table. Change paths HERE only.
 *
 * Transport rules implemented here:
 *  - Base URL `/api/v1` (same origin through the Vite dev proxy or nginx); cookie session,
 *    so every request uses `credentials: 'include'`. No token is ever stored in JS.
 *  - `X-Requested-With: kpmpl-web` on every request (server rejects writes without it, §3 CSRF).
 *  - `Idempotency-Key: <uuid v4>` on every POST/PATCH/PUT/DELETE except login and logout.
 *    Screens pass a key that is reused on retry (useWrite); otherwise one is generated.
 *  - `If-Match: <integer version>` on writes to an existing visit or package (§3). QC writes
 *    send the VISIT version; package and HO writes send the PACKAGE version.
 *  - `{ data }` success envelope, `{ error: { code, message, fields, requestId, meta } }` errors,
 *    mapped onto ApiError. Unknown codes fall back by HTTP status.
 *  - 401 on anything but login / me / logout ⇒ session-expired event (login keeps the route).
 *  - Timeout via AbortController. Only GETs are retried (once, on a network failure);
 *    writes are never retried automatically (the user retries with the same key).
 *  - JSON is passed through untouched: decimals stay strings ("15000.000"), refs stay strings.
 */
import type { ReceivingApi } from '../ReceivingApi';
import { ApiError, type ApiErrorCode } from '../errors';
import { config } from '../../config';
import { emitSessionExpired } from '../../auth/sessionEvents';
import { uuidV4 } from '../../lib/ids';
import type {
  CreatedUser, DocumentPackageView, OverviewData, Page, QcInspection, QcQueueItem, ReceivingVisit, ReferenceData,
  TemporaryPasswordResult, TimelineEvent, User,
} from '../../domain/types';

export const KNOWN_ERROR_CODES: readonly ApiErrorCode[] = [
  'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'VALIDATION_FAILED', 'DUPLICATE_CANDIDATE',
  'VERSION_CONFLICT', 'DOMAIN_RULE', 'NETWORK_UNAVAILABLE', 'SERVER_ERROR',
];
const isKnownCode = (c: unknown): c is ApiErrorCode => typeof c === 'string' && (KNOWN_ERROR_CODES as readonly string[]).includes(c);

const SERVER_ERROR_MESSAGE = 'Something went wrong. Nothing was saved.';
const NO_IK_PATHS = new Set(['/auth/login', '/auth/logout']);
/** Calls whose 401 means "wrong credentials / not signed in yet", not "session expired". */
const AUTH_PROBE_PATHS = new Set(['/auth/login', '/auth/me', '/auth/logout']);

export interface HttpAdapterDeps {
  baseUrl: string;
  timeoutMs: number;
  /** Injected for tests; defaults to the global fetch at call time. */
  fetch?: typeof fetch;
  onSessionExpired?: () => void;
  /** Delay before the single GET retry (ms). */
  retryDelayMs?: number;
}

interface RequestOptions {
  json?: unknown;
  form?: FormData;
  idempotencyKey?: string;
  ifMatch?: number;
  timeoutMs?: number;
  accept?: string;
}

function fallbackCode(status: number): ApiErrorCode {
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'VERSION_CONFLICT';
  if (status === 413 || status === 422 || status === 400) return 'VALIDATION_FAILED';
  if (status === 429) return 'DOMAIN_RULE';
  if (status === 502 || status === 503 || status === 504) return 'NETWORK_UNAVAILABLE';
  return 'SERVER_ERROR';
}

function fallbackMessage(status: number, code: ApiErrorCode): string {
  if (status === 413) return 'The file is larger than the upload limit.';
  if (status === 429) return 'Too many attempts. Wait a minute and try again.';
  if (code === 'NETWORK_UNAVAILABLE') return 'The server could not be reached.';
  if (code === 'SERVER_ERROR') return SERVER_ERROR_MESSAGE;
  return 'Request failed.';
}

const asRecord = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

function stringRecord(v: unknown): Record<string, string> {
  const r = asRecord(v);
  if (!r) return {};
  const out: Record<string, string> = {};
  for (const [k, x] of Object.entries(r)) if (typeof x === 'string') out[k] = x;
  return out;
}

/** Turn a non-2xx response into an ApiError (brief §3 error envelope). Exported for tests. */
export async function toApiErrorFromResponse(res: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null; // HTML from a proxy, empty body, etc.
  }
  const env = asRecord(asRecord(body)?.error);
  const code = isKnownCode(env?.code) ? env.code : fallbackCode(res.status);
  const message = typeof env?.message === 'string' && env.message ? env.message : fallbackMessage(res.status, code);
  const fields = stringRecord(env?.fields);
  if (res.status === 413 && !fields.file) fields.file = 'The file is larger than the upload limit.';
  const requestId = typeof env?.requestId === 'string' ? env.requestId : res.headers.get('X-Request-Id') ?? undefined;
  const meta = asRecord(env?.meta) ?? {};
  return new ApiError(code, message, res.status, fields, requestId, meta);
}

const enc = encodeURIComponent;

export const qs = (o: object) => {
  const p = new URLSearchParams();
  Object.entries(o).forEach(([k, v]) => {
    if (v === undefined || v === '' || v === null) return;
    if (Array.isArray(v)) v.forEach((x) => p.append(k, String(x)));
    else p.set(k, String(v));
  });
  const s = p.toString();
  return s ? `?${s}` : '';
};

function filenameFrom(res: Response, fallback: string): string {
  const cd = res.headers.get('Content-Disposition') ?? '';
  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      /* fall through */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(cd);
  return plain?.[1] ?? fallback;
}

export function createHttpAdapter(deps: HttpAdapterDeps): ReceivingApi {
  const base = deps.baseUrl.replace(/\/+$/, '');
  const expire = deps.onSessionExpired ?? emitSessionExpired;
  const retryDelay = deps.retryDelayMs ?? 300;
  // Bumped on every successful login/logout. A 401 on a request that started
  // before the current login belongs to an already-dead session (e.g. an in-flight
  // poll from the previous user that resolves after sign-out) and must NOT expire
  // the freshly established one.
  let sessionEpoch = 0;

  async function send(method: string, path: string, o: RequestOptions): Promise<Response> {
    const isWrite = method !== 'GET' && method !== 'HEAD';
    const headers: Record<string, string> = {
      Accept: o.accept ?? 'application/json',
      'X-Requested-With': 'kpmpl-web',
    };
    if (o.json !== undefined) headers['Content-Type'] = 'application/json';
    // multipart: let the browser set Content-Type with the boundary.
    if (isWrite && !NO_IK_PATHS.has(path)) headers['Idempotency-Key'] = o.idempotencyKey || uuidV4();
    if (o.ifMatch !== undefined) headers['If-Match'] = String(o.ifMatch);

    const doFetch = deps.fetch ?? globalThis.fetch.bind(globalThis);
    const attempts = isWrite ? 1 : 2;
    for (let attempt = 1; ; attempt++) {
      const ctrl = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        ctrl.abort();
      }, o.timeoutMs ?? deps.timeoutMs);
      try {
        return await doFetch(`${base}${path}`, {
          method,
          credentials: 'include',
          headers,
          body: o.form ?? (o.json !== undefined ? JSON.stringify(o.json) : undefined),
          signal: ctrl.signal,
        });
      } catch {
        if (timedOut) {
          throw new ApiError(
            'NETWORK_UNAVAILABLE',
            isWrite
              ? 'The server did not answer in time. It may or may not have saved. Try again: the same request is safe to repeat.'
              : 'The server did not answer in time.',
            0, {}, undefined, { timeout: true },
          );
        }
        if (attempt >= attempts) throw new ApiError('NETWORK_UNAVAILABLE', 'The server could not be reached.', 0);
        await new Promise((r) => setTimeout(r, retryDelay));
      } finally {
        clearTimeout(timer);
      }
    }
  }

  async function fail(path: string, res: Response, startedEpoch: number): Promise<never> {
    const err = await toApiErrorFromResponse(res);
    if (err.code === 'UNAUTHENTICATED' && startedEpoch === sessionEpoch && !AUTH_PROBE_PATHS.has(path.split('?')[0] ?? path)) expire();
    throw err;
  }

  async function call<T>(method: string, path: string, o: RequestOptions = {}): Promise<T> {
    const startedEpoch = sessionEpoch;
    const res = await send(method, path, o);
    if (!res.ok) return fail(path, res, startedEpoch);
    if (res.status === 204) return undefined as T;
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new ApiError('SERVER_ERROR', 'The server returned an unexpected response.', res.status);
    }
    const env = asRecord(body);
    if (!env || !('data' in env)) throw new ApiError('SERVER_ERROR', 'The server returned an unexpected response.', res.status);
    return env.data as T;
  }

  const v = (o: { idempotencyKey: string; expectedVersion: number }): RequestOptions => ({ idempotencyKey: o.idempotencyKey, ifMatch: o.expectedVersion });
  const inspections = (visitId: string) => call<QcInspection[]>('GET', `/receiving-visits/${enc(visitId)}/qc-inspections`);

  return {
    /* ---- 5.1 auth ---- */
    login: async (username, password) => {
      const user = await call<User>('POST', '/auth/login', { json: { username, password } });
      sessionEpoch++;
      return user;
    },
    me: async () => {
      try {
        return await call<User>('GET', '/auth/me');
      } catch (e) {
        if (e instanceof ApiError && e.code === 'UNAUTHENTICATED') return null;
        throw e;
      }
    },
    logout: async () => {
      sessionEpoch++;
      try {
        await call<void>('POST', '/auth/logout');
      } catch (e) {
        if (!(e instanceof ApiError && e.code === 'UNAUTHENTICATED')) throw e;
      }
    },
    changePassword: async (input, o) => {
      const path = '/auth/change-password';
      const res = await send('POST', path, { json: input, idempotencyKey: o.idempotencyKey });
      if (res.ok) return;
      const err = await toApiErrorFromResponse(res);
      if (err.code === 'UNAUTHENTICATED') {
        // A 401 here is either a wrong current password or a dead session; ask the server which.
        const still = await call<User>('GET', '/auth/me').then(() => true, () => false);
        if (!still) {
          expire();
          throw err;
        }
        throw new ApiError('VALIDATION_FAILED', 'Please check the highlighted fields.', 422, { currentPassword: 'Current password is incorrect.' }, err.requestId);
      }
      throw err;
    },

    /* ---- 5.2 receiving ---- */
    listVisits: (q) => call<Page<ReceivingVisit>>('GET', `/receiving-visits${qs(q)}`),
    getVisit: (id) => call<ReceivingVisit>('GET', `/receiving-visits/${enc(id)}`),
    createVisit: (input, o) => call<ReceivingVisit>('POST', '/receiving-visits', { json: input, idempotencyKey: o.idempotencyKey }),
    correctVisit: (id, input, o) => call<ReceivingVisit>('PATCH', `/receiving-visits/${enc(id)}`, { json: input, ...v(o) }),
    getTimeline: (id) => call<TimelineEvent[]>('GET', `/receiving-visits/${enc(id)}/timeline`),
    getReferenceData: () => call<ReferenceData>('GET', '/reference-data/receiving'),

    /* ---- 5.3 gate follow-up ---- */
    recordTare: (id, input, o) =>
      call<ReceivingVisit>('POST', `/receiving-visits/${enc(id)}/weighments`, {
        json: { kind: 'tare', value: input.value, unit: 'kg', ...(input.correctionReason ? { correctionReason: input.correctionReason } : {}) },
        ...v(o),
      }),
    recordExit: (id, input, o) => call<ReceivingVisit>('POST', `/receiving-visits/${enc(id)}/exit`, { json: input, ...v(o) }),
    recordGrn: (id, input, o) => call<ReceivingVisit>('POST', `/receiving-visits/${enc(id)}/grn-links`, { json: input, ...v(o) }),

    /* ---- 5.4 QC ---- */
    getQcQueue: () => call<QcQueueItem[]>('GET', '/qc/queue'),
    getQcInspection: async (visitId) => (await inspections(visitId))[0] ?? null,
    submitQc: (visitId, input, o) => call<QcInspection>('POST', `/receiving-visits/${enc(visitId)}/qc-inspections`, { json: input, ...v(o) }),
    // D-03: the QC Operator's final decision on submitted readings.
    decideQc: async (visitId, input, o) => {
      const insp = (await inspections(visitId))[0];
      if (!insp) throw new ApiError('NOT_FOUND', 'Record not found.', 404);
      // If-Match carries the VISIT version (brief §3 "Which version is checked").
      return call<QcInspection>('POST', `/qc-inspections/${enc(insp.inspectionId)}/decisions`, { json: input, ...v(o) });
    },

    /* ---- 5.5 overview and reports ---- */
    getOverview: () => call<OverviewData>('GET', '/reports/overview'),
    exportReceivingCsv: async (range = {}) => {
      const path = `/reports/receiving.csv${qs(range)}`;
      const res = await send('GET', path, { accept: 'text/csv', timeoutMs: deps.timeoutMs * 3 });
      if (!res.ok) return fail(path, res, sessionEpoch);
      const blob = await res.blob();
      const today = new Date().toISOString().slice(0, 10);
      return { filename: filenameFrom(res, `kpmpl-receiving-${today}.csv`), blob };
    },

    /* ---- 5.6 administration ---- */
    listUsers: () => call<User[]>('GET', '/admin/users'),
    createUser: (input, o) => call<CreatedUser>('POST', '/admin/users', { json: input, idempotencyKey: o.idempotencyKey }),
    updateUser: (id, input, o) => call<User>('PATCH', `/admin/users/${enc(id)}`, { json: input, idempotencyKey: o.idempotencyKey }),
    adminResetPassword: (id, o) => call<TemporaryPasswordResult>('POST', `/admin/users/${enc(id)}/reset-password`, { idempotencyKey: o.idempotencyKey }),

    /* ---- 5.7 document packages ---- */
    listPackages: (scope) => call<DocumentPackageView[]>('GET', scope === 'ho' ? '/head-office/cases' : scope === 'accounting' ? '/accounting/queue' : '/document-packages'),
    getPackage: (id) => call<DocumentPackageView>('GET', `/document-packages/${enc(id)}`),
    createPackage: (input, o) => call<DocumentPackageView>('POST', '/document-packages', { json: input, idempotencyKey: o.idempotencyKey }),
    updatePackage: (id, input, o) => call<DocumentPackageView>('PATCH', `/document-packages/${enc(id)}`, { json: input, ...v(o) }),
    attachFile: (id, input, o) => {
      const form = new FormData();
      form.append('category', input.category);
      form.append('file', input.file, input.file.name);
      return call<DocumentPackageView>('POST', `/document-packages/${enc(id)}/files`, { form, ...v(o), timeoutMs: deps.timeoutMs * 6 });
    },
    removeFile: (id, category, fileId, o) =>
      call<DocumentPackageView>('DELETE', `/document-packages/${enc(id)}/files/${enc(fileId)}${qs({ category })}`, v(o)),
    setNotApplicable: (id, category, reason, o) =>
      call<DocumentPackageView>('PUT', `/document-packages/${enc(id)}/items/${enc(category)}/applicability`, { json: { notApplicableReason: reason }, ...v(o) }),
    packageAction: (id, action, o) => call<DocumentPackageView>('POST', `/document-packages/${enc(id)}/actions`, { json: action, ...v(o) }),
    fileContentUrl: (fileId) => `${base}/document-files/${enc(fileId)}/content`,

    /* ---- 5.8 Head Office and ERP milestones ---- */
    hoCheckItem: (id, category, check, note, o) =>
      // The contract's note is optional-but-not-nullable; omit the key entirely when
      // no note accompanies the check (an explicit null is rejected as invalid).
      call<DocumentPackageView>('POST', '/head-office/reviews', { json: { packageId: id, category, check, ...(note ? { note } : {}) }, ...v(o) }),
    recordErpMilestone: (id, input, o) => call<DocumentPackageView>(
      'POST',
      input.type === 'plant_head_grn_approval'
        ? `/document-packages/${enc(id)}/erp-milestones/plant-head-approval`
        : `/head-office/cases/${enc(id)}/erp-milestones`,
      { json: input, ...v(o) },
    ),
    sendReminder: (id, note, o) => call<DocumentPackageView>('POST', `/head-office/cases/${enc(id)}/reminders`, { json: { note }, ...v(o) }),

    /* ---- accounting workflow (upgrade 2026-11-03) ---- */
    accountingAction: (id, action, o) => call<DocumentPackageView>('POST', `/document-packages/${enc(id)}/accounting`, { json: action, ...v(o) }),
    recordAccountingChecks: (id, checks, o) => call<DocumentPackageView>('POST', `/accounting/cases/${enc(id)}/checks`, { json: checks, idempotencyKey: o.idempotencyKey }),
    headAccountantCases: () => call<DocumentPackageView[]>('GET', '/head-accountant/cases'),
  };
}

export const httpAdapter: ReceivingApi = /* @__PURE__ */ createHttpAdapter({ baseUrl: config.apiBaseUrl, timeoutMs: config.requestTimeoutMs });
