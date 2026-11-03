# KPMPL Gate-to-Bill — Backend Build Brief (for an AI coding agent)

> **How to use this file:** Give this whole document to your AI coding agent as its task. Section 0 is the prompt itself. Everything after it is the specification the agent must follow. Also give the agent the frontend source (`kpmpl-frontend-v0.2.x.zip`) and the requirements baseline (`00`–`17` markdown files). Where this brief and the frontend code disagree on an endpoint or a field, **the frontend code (`src/api/http/httpAdapter.ts` and `src/domain/types.ts`) wins**, because the UI is already built against it.

---

## 0. The prompt

You are a senior backend engineer. Build the production-grade backend for **KPMPL Integrated Gate-to-Bill Workflow Management System** for Kaygaon Paper Mills Pvt. Ltd. (client), developed by PRAVAHAx Systems Engineering.

A complete React + TypeScript frontend already exists. It talks to the server only through one interface, `ReceivingApi` (`src/api/ReceivingApi.ts`), and ships a real HTTP adapter (`src/api/http/httpAdapter.ts`). The frontend also has a mock adapter (`src/api/mock/mockAdapter.ts`) that already implements every business rule in the browser. **Your job is to move those rules to a real, secure, persistent, multi-user server** so that every role, on any device, sees the same live data. Then switch the frontend to the HTTP adapter with no UI changes beyond what this brief lists.

Non-negotiable rules:

1. **The server is the single source of truth and the only authority.** Every read, write and export checks authentication and the per-action permission on the server. Hiding a button in the UI is never security.
2. **Match the frontend contract exactly**: paths, methods, headers, JSON shapes, field names, enum values and error codes, as defined in Section 5. Do not rename anything. If you believe a change is needed, list it in `CONTRACT_CHANGES.md` and change the frontend adapter in the same pull request.
3. **Never invent business rules.** Do not invent QC formulas, deduction amounts, approval authority, mandatory document lists, exit eligibility or ERP behaviour. Where KPMPL has not decided, implement the prototype default from Section 7 as a **named, configurable policy** and label it pending in the API response or docs.
4. **DataMan (the ERP) is not integrated.** Every ERP reference (Gate Entry No., GRN, PO, challan, voucher, posting) is typed by staff and stored as an **opaque string, exactly as typed**. Never parse it as a number, never strip leading zeros, never "validate" its format beyond length and safe characters. Every ERP milestone is recorded as `source = manual_staff_confirmation`.
5. **Weights and readings are decimals**, stored as `NUMERIC` and transported as **strings** (`"15000.000"`). Never use binary floating point for stored quantities.
6. **History is never erased.** Corrections need a reason, and old values stay in an append-only audit log. QC revisions are new rows, never in-place edits.
7. **All writes are safe to retry and safe under concurrency**, using `Idempotency-Key` and optimistic locking with `If-Match: <version>`.
8. **Synthetic data only** in seeds, tests and fixtures (`DEMO-` prefixes). No real KPMPL names, invoices or credentials, and no secrets in Git.
9. Write tests first for every rule in Section 7. The work is done only when the Section 12 acceptance suite passes in CI.

Deliver in the milestones of Section 13. At the end of each milestone, stop and report:
- what was built and what was tested (with the test output summary);
- what is still pending;
- any open decision you had to default.

---

## 1. Product summary (what the system does)

A truck arrives at the mill gate with waste paper. The flow is:

**Module 1: Gate → QC → Gate**
1. **Gate Operator** creates a *Receiving Visit*: ERP Gate Entry No. (typed from DataMan), vehicle, supplier, material, optional challan/PO, gross weight. The visit goes to the QC queue.
2. **QC Operator** records readings (moisture %, impurity %, remarks). They can save a draft or submit.
3. **QC Operator** then makes the final QC decision on the submitted readings: accept, accept with deduction, reject, or return for correction (a return reopens the readings for a new revision). *KPMPL decision D-03, 2026-11-03: there is no separate decision-maker role; the QC Operator decides.*
4. **Gate Operator** records the tare (empty) weight, then records the physical exit, then records the official GRN reference typed from DataMan. QC, exit and GRN are **three independent status domains**. There is never a single combined status.

**Module 2: Documents → Head Office → ERP milestones**
5. **Gate / Gate Document Authority** builds a *Document Package* for one supplier invoice. It covers one or more trucks from the same supplier, and each truck is in at most one package. The package has 6 candidate checklist rows. Each row is resolved by attaching PDFs or by marking it not applicable with a reason. The Gate marks it ready.
6. **Gate Document Authority** (named staff) checks it and sends it to Head Office, or sends it back to draft.
7. **Head Office Accounts** starts the review, checks each attached document (OK or issue), then either requests a correction (back to Gate, then resubmitted) or verifies the documents.
8. **Head Office** records DataMan milestones that staff confirm by hand, in strict order: Plant Head GRN approval → Purchase Bill/Voucher → Final posting. They can reverse the latest one with a reason, and log reminders (in-app only; nothing is sent).

**Admin**: user and role management. **Overview**: operational counters and lists for management.

Capacity baseline: 10 named users, 5 concurrent sessions, one mill and one HO, English, online-only (no offline sync). Design so Android/iOS clients can use the same API later.

---

## 2. Technology stack (industry-standard default; replaceable via ADR)

Doc 17 says the ADRs are open. Use this stack unless PRAVAHAx overrides it, and record each choice as an ADR in `docs/adr/`.

| Concern | Choice | Why |
|---|---|---|
| Runtime / language | **Node.js 22 LTS + TypeScript (strict)** | Same language as the frontend, so domain types can be shared. |
| Web framework | **NestJS 10 (Fastify adapter)** | Modules map 1:1 to doc 17's service boundaries. Guards, pipes, DI and OpenAPI generation are built in. |
| Validation | **Zod** schemas (shared with frontend types) via a Nest pipe | One schema gives runtime validation plus TypeScript types plus OpenAPI. |
| Database | **PostgreSQL 16** | `NUMERIC`, transactions, row locks, JSONB, mature backups. |
| ORM / migrations | **Prisma 5** (or Drizzle) with versioned SQL migrations | Typed queries, reviewed migrations, `Decimal` support. |
| Auth | **Server-side sessions** in Postgres (`HttpOnly; Secure; SameSite=Lax` cookie), **argon2id** password hashing. Bearer-token option behind the same guard for future mobile. | Matches the adapter's `credentials: 'include'`. Revocable, with no JWT-in-localStorage risk. |
| File storage (M2) | **S3-compatible private bucket** (AWS S3 / Cloudflare R2 / MinIO in dev). Server streams files after an auth check. | Private, recoverable, no public URLs. |
| Malware scanning | **ClamAV** (clamd sidecar) scanning before a file is marked available | Doc 10: KPM-NFR-005. |
| API docs | **OpenAPI 3.1** generated at `/api/v1/docs` (disabled in prod or behind admin) | Contract handshake (06 §5). |
| Logging | **pino** structured JSON logs with `requestId`. No passwords, tokens or file contents in logs. | KPM-NFR-002. |
| Tests | **Vitest** (unit), **Supertest** (HTTP), **Testcontainers** (real Postgres + MinIO) | Rules are tested against a real DB, not mocks. |
| Packaging | **Docker** multi-stage image, non-root user, `docker-compose.yml` for dev (api, postgres, minio, clamav) | Client-owned cloud deployment. |
| CI | GitHub Actions: lint, typecheck, unit, integration, migration check, `npm audit`, build image | Must pass before merge. Never push to `main` directly. |

Repository layout:

```
kpmpl-backend/
  src/
    main.ts                 # bootstrap, security middleware, /api/v1 prefix
    common/                 # envelope, errors, idempotency, versioning, request-id, decimal, clock, audit
    config/                 # env schema (zod), policy flags (Section 7)
    modules/
      identity/             # auth, sessions, users, roles, permissions guard
      receiving/            # visits, corrections, reference data, timeline
      weighment/            # tare (gross is set at create/correct)
      qc/                   # inspections, revisions, review (demo), queues
      movement/             # exit, GRN reference
      documents/            # packages, checklist items, files, gate actions
      head-office/          # inbox, item checks, corrections, verify
      erp-milestones/       # manual staff-confirmed milestones, reminders
      reports/              # overview, CSV export
      audit/                # append-only event log, read APIs
  prisma/ (schema.prisma, migrations/, seed.ts)
  test/ (unit/, integration/, acceptance/)
  docs/ (adr/, CONTRACT_CHANGES.md, RUNBOOK.md, SECURITY.md)
  Dockerfile, docker-compose.yml, .env.example
```

Layering inside every module (doc 17 §3): **Controller (DTO validation) → Auth guard → Application service (use case) → Domain rules / state machine → Repository in one DB transaction + audit append**. Business rules live in the domain or service layer, never in controllers.

---

## 3. Cross-cutting API conventions (must match the frontend)

**Base URL:** `/api/v1`. Frontend config: `VITE_API_BASE_URL=https://<host>/api/v1`.

**Success envelope:** `200/201` → `{ "data": <payload> }`. `204` → no body (logout only).
For paged lists the payload itself is a `Page`: `{ "data": { "data": [...], "page": 1, "pageSize": 50, "total": 123 } }`.

**Error envelope** (every non-2xx):
```json
{ "error": { "code": "VALIDATION_FAILED", "message": "Please check the highlighted fields.",
             "fields": { "grossWeight": "Enter a gross weight greater than zero." },
             "requestId": "req_01J...", "meta": {} } }
```

| code | HTTP | When |
|---|---|---|
| `UNAUTHENTICATED` | 401 | No or expired session, or a deactivated user |
| `FORBIDDEN` | 403 | Authenticated but lacks the capability |
| `NOT_FOUND` | 404 | Missing **or not visible to this role** (do not leak existence) |
| `VALIDATION_FAILED` | 422 | Field errors. `fields` keys equal the input field names the UI uses |
| `DUPLICATE_CANDIDATE` | 409 | Same Gate Entry No. already exists; `meta.existingId` |
| `VERSION_CONFLICT` | 409 | `If-Match` version is stale; `meta.currentVersion` |
| `DOMAIN_RULE` | 422 | A state or business rule blocks the action (human sentence in `message`) |
| `SERVER_ERROR` | 500 | Unexpected; message "Something went wrong. Nothing was saved." Log full details server-side only |

Field error messages must be short, plain-English sentences a gate operator understands. Copy them from the mock adapter, which already has the approved wording.

**Headers on writes:**
- `Idempotency-Key: <uuid>` is **required** on every POST, PATCH, PUT and DELETE except login and logout. Store `(key, userId, method, path, requestHash, responseStatus, responseBody, createdAt)` for 24 h.
  - The same key with the same request replays the stored response.
  - The same key with a different body returns 422 `VALIDATION_FAILED` with the message "Idempotency key reused with different data".
  - Write the record inside the same transaction as the change.
- `If-Match: <integer version>` is **required** on every write to an existing visit or package.
  - Compare it with the row's `version` under `SELECT ... FOR UPDATE`.
  - On a mismatch, return `VERSION_CONFLICT`.
  - Every successful write increments `version` by 1 and returns the full updated resource.

**Which version is checked:** QC writes (`submitQc`, `decideQc`) send the **visit's** version, not the inspection's, and every QC write bumps the visit version. All package writes use the **package** version.

**Other conventions:**
- **IDs:** opaque server-generated strings (UUIDv7 or ULID). Human refs such as `DEMO-PKG-0003` come from a Postgres sequence and are display-only.
- **Times:** store `timestamptz` in UTC and return ISO-8601 UTC (`2026-11-02T06:27:00.000Z`). The UI formats to IST. Keep **event time** (e.g. `physicalExitAt`, `erpOccurredAt`) separate from **record time** (`recordedAt`/`confirmedAt`).
- **Decimals:** accept `^\d{1,9}(\.\d{1,3})?$` for kg and `^\d{1,3}(\.\d{1,2})?$` for percent. Store `NUMERIC(12,3)` and `NUMERIC(5,2)`. Always return strings with fixed scale (`"15000.000"`). Net weight is **derived for display only** and never stored as authoritative.
- **Text inputs:** trim, enforce max lengths, and allow the safe character set `^[\p{L}\p{N} .,/&()'_#:-]*$` for refs and names. Reasons and notes allow free text up to the stated length and are stored escaped. Reject control characters.
- **CORS:** allow only the configured frontend origin(s), with credentials. **CSRF:** with cookie sessions, require `SameSite=Lax` and check the `Origin` header on all state-changing requests. The frontend must also send the `X-Requested-With: kpmpl-web` header; reject writes without it.
- **Rate limits:** login 5/min per IP+username, with progressive lockout after 10 failures for 15 min. General API 300/min per session.
- **Security headers:** Helmet defaults, HSTS in prod, `Cache-Control: no-store` on API responses and file downloads.
- **Request size limits:** JSON 100 KB; uploads 10 MB (configurable).

---

## 4. Roles and permissions (server-enforced)

Capabilities (exact strings, from `src/auth/permissions.ts`):
`receiving.view, receiving.create, receiving.edit, gate.followup, qc.queue.view, qc.measure, qc.decide, overview.view, docs.prepare, docs.submit, ho.inbox, ho.review, erp.confirm, admin.users`

| Role code | Label | Capabilities |
|---|---|---|
| `gate` | Gate Operator | receiving.view, receiving.create, receiving.edit, gate.followup, qc.queue.view, overview.view, docs.prepare |
| `gate_doc` | Gate Document Authority | receiving.view, overview.view, docs.prepare, docs.submit |
| `qc` | QC Operator | receiving.view, qc.queue.view, qc.measure, qc.decide, overview.view |
| `ho` | Head Office Accounts | receiving.view, overview.view, ho.inbox, ho.review, erp.confirm |
| `admin` | System Admin | receiving.view, overview.view, ho.inbox, admin.users |

Implementation rules:
- Store roles and capabilities in tables (`role`, `role_capability`, `user_role`), seeded from this matrix, so KPMPL decision D-07 changes **data, not code**.
- Use a `@RequireCapability('x')` or `@RequireAny([...])` decorator plus a guard, applied to **every** route. Add a CI test that fails if any route lacks one (except login).
- A user may hold several roles; capabilities are the union.
- Record-level visibility:
  - Head Office sees packages only in `HO_VISIBLE` states (`submitted_to_ho, under_ho_review, correction_requested, resubmitted, verified`). Otherwise return `NOT_FOUND`.
  - Drafts stay with the Gate.
- Deactivated users cannot log in. Revoke their sessions immediately. Their names stay in history.
- Admin safeguards: at least one active `admin` must always remain, and an admin cannot deactivate themselves.
- `qc.decide` (D-03, decided by KPMPL 2026-11-03) is held by the QC Operator: the same person who submits the readings records the final QC decision, so there is no separation-of-duties check between the two steps. It is a real step, not a demonstration: new decision records have `demonstrationOnly: false` (records made before the decision keep `true`). The former `QC_REVIEW_ENABLED` flag is retired (still accepted in `.env`, ignored).

---

## 5. Endpoint contract (exact; mirrors `httpAdapter.ts`)

Notation: **cap** = required capability. **IK** = Idempotency-Key required. **IM** = If-Match required. All responses are wrapped in `{ data }`.

### 5.1 Auth
| Method & path | cap | Body | Returns |
|---|---|---|---|
| `POST /auth/login` | public | `{ username, password }` | `User`; sets the session cookie. Wrong credentials → 401 `UNAUTHENTICATED` "Username or password is incorrect." (same message for unknown user) |
| `GET /auth/me` | any | — | `User` or 401 |
| `POST /auth/logout` | any | — | 204; deletes the session |

`User = { id, username, displayName, roles: RoleCode[], synthetic: boolean, active: boolean }`

Sessions: 12 h absolute and 2 h idle (configurable). Rotate the session ID on login and on role change.

### 5.2 Receiving
| Method & path | cap | Notes |
|---|---|---|
| `GET /receiving-visits?search=&qcStatus=a&qcStatus=b&exitStatus=&grnStatus=&page=&pageSize=` | any of receiving.view, docs.prepare | `search` is case-insensitive over gate entry ref, vehicle, supplier and GRN ref. Sorted `createdAt DESC`. `pageSize` max 500, default 50. Returns `Page<ReceivingVisit>` |
| `GET /receiving-visits/{id}` | any of receiving.view, qc.queue.view, docs.prepare, ho.inbox | `ReceivingVisit` |
| `POST /receiving-visits` | receiving.create · IK | `CreateReceivingVisitInput` → 201 `ReceivingVisit`. Sets qcStatus `pending`, exitStatus `on_premises`, grnStatus `not_recorded`, version 1 |
| `PATCH /receiving-visits/{id}` | receiving.edit · IK · IM | `CorrectVisitInput` (all editable fields + `reason`). See rule R-03 |
| `GET /receiving-visits/{id}/timeline` | any of receiving.view, ho.inbox | `TimelineEvent[]`, newest first |
| `GET /reference-data/receiving` | authenticated | `{ suppliers: string[], materials: string[] }`. Distinct values in use plus a seeded admin-managed list |

`ReceivingVisit` fields exactly: `id, officialGateEntryRef, vehicleNumber, supplierDisplayName, materialDisplayName, challanRef|null, poRef|null, arrivedAt|null, grossWeight: {value,unit:'kg'}|null, tareWeight|null, notes|null, qcStatus, exitStatus, grnStatus, officialGrnRef|null, physicalExitAt|null, createdAt, createdBy (display name), updatedAt, version`.

`TimelineEvent = { id, at, actor (display name), action, detail?, source: 'app' | 'manual_staff_confirmation' }`.

### 5.3 Gate follow-up (three independent writes)
| Method & path | cap | Body |
|---|---|---|
| `POST /receiving-visits/{id}/weighments` | gate.followup · IK · IM | `{ kind: 'tare', value: "4000.000", unit: 'kg', correctionReason? }` → `ReceivingVisit` |
| `POST /receiving-visits/{id}/exit` | gate.followup · IK · IM | `{ physicalExitAt, remarks?, millChecksConfirmed: true }` → `ReceivingVisit` |
| `POST /receiving-visits/{id}/grn-links` | gate.followup · IK · IM | `{ officialGrnRef, verifiedInDataManByStaff: true, correctionReason? }` → `ReceivingVisit` |

### 5.4 QC
| Method & path | cap | Notes |
|---|---|---|
| `GET /qc/queue` | qc.queue.view | `QcQueueItem[]` for qcStatus in `pending, in_progress, returned, submitted`, oldest first. `submitted` rows are awaiting the QC Operator's decision |
| `GET /receiving-visits/{id}/qc-inspections` | any of qc.queue.view, receiving.view, ho.inbox | **Array** with 0 or 1 `QcInspection` (the frontend reads `[0]`) |
| `POST /receiving-visits/{id}/qc-inspections` | qc.measure · IK · IM(visit) | `QcSubmitInput { measurements: [{code:'moisture'|'impurity', value, unit:'percent'}], remarks?, revisionReason?, intent: 'draft'|'submit' }` → `QcInspection` |
| `POST /qc-inspections/{inspectionId}/decisions` | qc.decide · IK · IM(**visit** version) | `{ outcome: 'returned'|'accepted'|'accepted_with_deduction'|'rejected', reason }` → `QcInspection` |

`QcInspection = { inspectionId, visitId, qcStatus, revisions: QcRevision[], reviews: QcReviewNote[], deductionCalculation: { status: 'not_configured', value: null } }`.
`QcRevision = { revision, state: 'draft'|'submitted', measurements, remarks, revisionReason, recordedBy, recordedAt }`.
`QcReviewNote = { outcome, reason, demonstrationOnly: boolean, recordedBy, recordedAt, forRevision }` (the QC decision record; `demonstrationOnly` is `true` only on records made before D-03 was decided).
`QcQueueItem = { visit: ReceivingVisit, latestRevision: number|null, lastReturnReason: string|null }`.

### 5.5 Overview and reports
| Method & path | cap | Notes |
|---|---|---|
| `GET /reports/overview` | overview.view | `OverviewData`. Compute counters in SQL exactly as defined in the mock `getOverview()`. "Today" means the **Asia/Kolkata** calendar day |
| `GET /reports/receiving.csv?from=&to=` | overview.view | Server-side CSV (UTF-8 BOM, RFC 4180). Prevent formula injection by prefixing `= + - @` cells with `'`. Columns are pending D-10, so use the frontend's current CSV columns |

### 5.6 Administration
| Method & path | cap | Notes |
|---|---|---|
| `GET /admin/users` | admin.users | `User[]` |
| `POST /admin/users` | admin.users · IK | `{ username, displayName, roles }`. Returns `User & { temporaryPassword: string }`. The password is returned only in this response and never again. Force a change at first login (`mustChangePassword`) |
| `PATCH /admin/users/{id}` | admin.users | `{ displayName?, roles?, active? }`. Enforce the admin safeguards |
| `POST /auth/change-password` | any | `{ currentPassword, newPassword }`. Minimum 10 characters, checked against a breached-password list. **New endpoint**: add a screen in the frontend |
| `POST /admin/users/{id}/reset-password` | admin.users · IK | Returns a new temporary password once and revokes the user's sessions |

### 5.7 Module 2: document packages (Gate side)
| Method & path | cap | Notes |
|---|---|---|
| `GET /document-packages` | docs.prepare | `DocumentPackageView[]`, all states, `updatedAt DESC` |
| `GET /document-packages/{id}` | any of docs.prepare, ho.inbox | `DocumentPackageView`. HO only if the status is in HO_VISIBLE |
| `POST /document-packages` | docs.prepare · IK | `{ visitIds: string[], invoiceRef? }` → 201 view |
| `PATCH /document-packages/{id}` | docs.prepare · IK · IM | `{ visitIds?, invoiceRef? }`. Only in GATE_EDITABLE states |
| `POST /document-packages/{id}/files` | docs.prepare · IK · IM | **multipart/form-data**: `category`, `file` (PDF). Returns the view. See 5.9 |
| `DELETE /document-packages/{id}/files/{fileId}?category=` | docs.prepare · IK · IM | Soft-delete (the file stays in storage and the audit log) |
| `PUT /document-packages/{id}/items/{category}/applicability` | docs.prepare · IK · IM | `{ notApplicableReason: string|null }` (null = undo) |
| `POST /document-packages/{id}/actions` | depends on `kind` · IK · IM | Body is a `PackageAction`: `{kind:'mark_ready'}` (docs.prepare), `{kind:'back_to_draft',reason}` (docs.submit), `{kind:'submit_to_ho',confirmComplete,responseNote?}` (docs.submit), `{kind:'start_review'}` (ho.review), `{kind:'request_correction',reason,categories}` (ho.review), `{kind:'verify'}` (ho.review) |
| `GET /document-files/{fileId}/content` | docs.prepare, or ho.inbox when the package is HO_VISIBLE | Streams the PDF with `Content-Type: application/pdf`, `Content-Disposition: inline; filename="..."`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`. **New**: the frontend's PDF viewer will use this URL |

### 5.8 Module 2: Head Office and ERP milestones
| Method & path | cap | Notes |
|---|---|---|
| `GET /head-office/cases` | ho.inbox | Packages in HO_VISIBLE states, `updatedAt DESC` |
| `POST /head-office/reviews` | ho.review · IK · IM(package) | `{ packageId, category, check: 'ok'|'issue'|'unchecked', note }` → view |
| `POST /head-office/cases/{id}/erp-milestones` | erp.confirm · IK · IM | `ErpMilestoneInput { type, action: 'confirm'|'reverse', dataManRef?, erpOccurredAt?, note?, verifiedInDataManByStaff }` → view |
| `POST /head-office/cases/{id}/reminders` | erp.confirm · IK · IM | `{ note }` → view. In-app record only |

`DocumentPackageView` = `DocumentPackage` (all fields in `types.ts`: `id, packageRef, visitIds, invoiceRef, supplierDisplayName, status, checklistVersion, items[6], submittedBy, submittedAt, corrections[], erp[3], reminders[], history[], createdBy, createdAt, updatedAt, version`) **plus** `visits: ReceivingVisit[]`, resolved. `items` is always the 6 categories in this order: `supplier_invoice, factory_grn, weighbridge_slip, qc_slip, supporting_bill, eway_bill`. `erp` is always in the order `plant_head_grn_approval, purchase_voucher, final_posting`.

### 5.9 File upload rules (M2)
- Accept only `application/pdf`. Verify the **magic bytes `%PDF-`**; do not trust the extension or the client MIME type. Max 10 MB (config `MAX_UPLOAD_MB`). Reject empty files.
- Stream to a private bucket under key `packages/{packageId}/{fileId}.pdf`. Store the SHA-256, size, original name (sanitised, max 120 chars), uploader and time.
- Scan with ClamAV.
  - Status `pending_scan` → `clean` | `infected`.
  - Infected files are quarantined, never served, and the upload fails with `DOMAIN_RULE` "This file failed the security scan."
  - If the scanner is down, fail closed (configurable).
- Never return storage URLs. All access goes through 5.7's content endpoint with permission checks.
- Bucket: block public access, server-side encryption on, versioning on.

---

## 6. Data model (PostgreSQL)

Use these tables (Prisma models). Every table gets `created_at` and `updated_at`. Mutable aggregates (visit, package) get an integer `version`.

- `app_user` (id, username unique lower, display_name, password_hash, must_change_password, active, synthetic, failed_logins, locked_until)
- `role`, `capability`, `role_capability`, `user_role`
- `session` (id hash, user_id, created_at, last_seen_at, expires_at, ip, user_agent)
- `receiving_visit` (id, official_gate_entry_ref **text**, vehicle_number, supplier_display_name, material_display_name, challan_ref, po_ref, arrived_at, gross_weight_kg NUMERIC(12,3), tare_weight_kg NUMERIC(12,3) null, notes, qc_status enum, exit_status enum, grn_status enum, official_grn_ref text null, physical_exit_at, created_by, version)
  - Index on `official_gate_entry_ref`; **not unique in DB yet** (uniqueness scope is KPM-X-003/D-01; enforced by policy in the service).
  - Trigram index (pg_trgm) for search.
- `qc_inspection` (id, visit_id unique, qc_status)
- `qc_revision` (id, inspection_id, revision int, state, remarks, revision_reason, recorded_by, recorded_at; unique(inspection_id, revision))
- `qc_measurement` (revision_id, code, value NUMERIC(5,2), unit)
- `qc_review` (id, inspection_id, outcome, reason, demonstration_only bool default false — true only on pre-D-03 records, for_revision, recorded_by, recorded_at): the QC Operator's decisions
- `document_package` (id, package_ref unique from a sequence, invoice_ref, supplier_display_name, status enum, checklist_version, submitted_by, submitted_at, created_by, version)
- `package_visit` (package_id, visit_id **unique**: one truck in one package) — C-06
- `document_item` (package_id, category enum, state enum, not_applicable_reason, ho_check enum, ho_note; unique(package_id, category))
- `document_file` (id, item_id, storage_key, original_name, size_bytes, sha256, mime, scan_status, uploaded_by, uploaded_at, deleted_at, deleted_by)
- `correction_request` (id, package_id, reason, categories text[], requested_by, requested_at, resolved_at, response_note)
- `erp_milestone` (package_id, type enum, status, dataman_ref text, erp_occurred_at, note, confirmed_by, confirmed_at, source default 'manual_staff_confirmation'; unique(package_id, type))
- `reminder` (id, package_id, recipient, note, sent_by, sent_at)
- `audit_event` **append-only** (id, at, actor_user_id, actor_display, entity_type, entity_id, action, detail, before jsonb, after jsonb, reason, source, request_id, ip)
  - DB role grants: INSERT and SELECT only, no UPDATE or DELETE. Optionally hash-chain (`prev_hash`) for tamper evidence.
  - Visit timeline and package history are **views over audit_event**. They are not separate mutable lists.
- `idempotency_record` (key, user_id, method, path, request_hash, status, body jsonb, created_at); TTL cleanup job.
- `reference_value` (kind 'supplier'|'material', value, active)

Display names in responses (`createdBy`, `recordedBy`, `actor`) come from a join to `app_user.display_name` **as stored at event time** in the audit row, so history survives renames.

---

## 7. Business rules (implement and test every one)

Rule IDs are referenced by the tests. "Policy" means a configurable flag in `config/policies.ts` with the prototype default, exposed read-only at `GET /config/policies` so the UI can label pending rules.

**Receiving**
- **R-01 Create.** Required fields and max lengths:
  - officialGateEntryRef (40), vehicleNumber (30), supplier (80), material (80) are required;
  - challanRef and poRef are optional (40 each);
  - grossWeight must be > 0.
- **R-02 Duplicate Gate Entry** (policy `GATE_ENTRY_UNIQUE_SCOPE = 'global'`, pending KPM-X-003). If the same exact string exists, return 409 `DUPLICATE_CANDIDATE` with `meta.existingId` and the message "A receiving visit with Gate Entry Number X already exists (vehicle Y)."
- **R-03 Correct Gate details.**
  - Only while `exitStatus = on_premises`; after exit, return `DOMAIN_RULE` "This truck has exited. Gate details are locked…" (post-exit authority pending).
  - A reason is required (max 500).
  - At least one field must change, else `VALIDATION_FAILED` with field `reason` "Change at least one field, or go back."
  - Gross must stay greater than any recorded tare.
  - The supplier cannot change while the visit is linked to a package.
  - Audit each change as `field: before → after`.

**Weighment / movement / GRN**
- **R-04 Tare.**
  - Not allowed after exit.
  - Value must be > 0 and < gross.
  - If a tare already exists, it is a correction: `correctionReason` is required and the old value is kept in the audit log.
- **R-05 Exit** (policy `EXIT_REQUIRES = ['tare','qc_readings_submitted','mill_checks_confirmed']`, pending D-04):
  - not already exited;
  - tare recorded, else "Record the tare (empty) weight before recording exit.";
  - qcStatus not in `pending, in_progress`;
  - `millChecksConfirmed` must be true;
  - physicalExitAt is not more than 5 min in the future and not before `createdAt` − 1 min;
  - returned or rejected QC does **not** block exit (the UI shows a caution).
- **R-06 GRN reference.**
  - Allowed only once a tare exists.
  - `verifiedInDataManByStaff` must be true.
  - A correction needs a reason and a different value.
  - The same GRN on other visits is **noted in the audit detail, not blocked** (D-01/D-11).
  - Audit source is `manual_staff_confirmation`.

**QC**
- **R-07 Submit readings.**
  - Allowed only when qcStatus is `pending`, `in_progress` or `returned`.
  - A submit requires both moisture and impurity.
  - A draft saves partial readings, keeps the case `in_progress` (or `returned` if returned), and overwrites the current draft revision.
  - A submit creates or finalises a revision and sets the status to `submitted`.
  - A resubmission after a return requires `revisionReason`.
  - Never compute a deduction: `deductionCalculation` is always `{status:'not_configured', value:null}` (D-02).
- **R-08 QC decision (by the QC Operator, D-03).**
  - Only when qcStatus is `submitted`.
  - Recorded by a holder of `qc.decide` (the QC Operator); the same user who submitted the readings may decide.
  - The reason is required for every outcome except `accepted` (max 1000).
  - The decision is stored against the latest submitted revision, with `demonstrationOnly: false`.
  - Sets the visit's qcStatus to the outcome. `returned` reopens the readings in the QC queue for a new revision.

**Documents**
- **R-09 Package membership.**
  - At least 1 visit.
  - All visits must have the same supplier, else "All linked trucks must be from the same supplier."
  - A visit can be in only one package; return the conflicting Gate Entry No. in the error.
  - The DB unique constraint on `package_visit.visit_id` is the final guard.
- **R-10 Editable states.** `GATE_EDITABLE = draft, ready_for_gate_check, correction_requested`. Otherwise "This package is with Head Office and cannot be changed now."
- **R-11 Checklist.**
  - Every package has the 6 candidate rows (`checklistVersion: 'demo-checklist-0 (not approved)'`, policy pending D-05).
  - A row is resolved when it is `attached` (≥ 1 clean file) or `not_applicable` (reason, max 300).
  - Marking a row not applicable is not allowed while files are attached.
  - Any file or applicability change resets that row's `hoCheck` to `unchecked`. If the package was `ready_for_gate_check`, it returns to `draft`, with an audit "Returned to draft".
- **R-12 Mark ready** (docs.prepare). Only from `draft`, and all rows must be resolved, else list the missing rows by label.
- **R-13 Back to draft** (docs.submit). Only from `ready_for_gate_check`, with a reason.
- **R-14 Send to HO** (docs.submit; **only the Document Authority sends**, C-08).
  - Allowed from `ready_for_gate_check` (→ `submitted_to_ho`) or `correction_requested` (→ `resubmitted`).
  - All rows must be resolved, and `confirmComplete` must be true.
  - A resubmission requires `responseNote` and resolves the open correction request.
  - Sets `submittedBy` and `submittedAt`, and writes an audit row on each linked visit.
  - It does **not** wait for Plant Head or final QC approval (C-09).
- **R-15 Start review.** From `submitted_to_ho` or `resubmitted` to `under_ho_review`.
- **R-16 Item check.**
  - Only `under_ho_review`, and only attached rows.
  - An `issue` requires a note (max 500).
- **R-17 Request correction.**
  - Only `under_ho_review`.
  - Requires a reason (max 1000) and at least 1 category.
  - Marks those rows `issue`, then sets the status to `correction_requested`.
- **R-18 Verify.** Only `under_ho_review`, and every attached row must be `ok`. Sets `verified`. ERP milestones stay separate.

**ERP milestones (manual)**
- **R-19 Confirm.**
  - The package must be HO_VISIBLE and the milestone not already confirmed.
  - Strict order: Plant Head approval → Voucher → Posting. C-10 is client-confirmed; posting after voucher is policy D-08.
  - `dataManRef` is required for the first two and optional for posting (max 40).
  - `verifiedInDataManByStaff` must be true, and `erpOccurredAt` cannot be in the future.
  - Audit source is `manual_staff_confirmation`, and the API response says "Manually confirmed by staff (not an ERP feed)".
- **R-20 Reverse.**
  - Only a confirmed milestone with no later milestone confirmed.
  - A reason is required.
  - The old reference is kept in the audit log.
- **R-21 Reminder.**
  - Only while Plant Head approval is pending; note max 300.
  - Recipient is "Plant Head (recipient and channel pending, D-09)".
  - **No external message is sent.** The notification channel is a pluggable interface with a no-op default.

**Admin**
- **R-22.** Username `^[a-z0-9][a-z0-9._-]{2,31}$`, unique and case-insensitive. At least one role. At least one active admin. No self-deactivation.

**Concurrency and atomicity** (applies to all of the above)
- Each command runs in **one transaction**: lock the aggregate (`FOR UPDATE`), check the version, check the rules, write, append the audit event, store the idempotency record, then commit.
- Any failure rolls back everything; there are no partial writes.
- Uploads: put the object to storage first, then the DB transaction. On DB failure, delete the orphan object. A nightly job sweeps orphans.

---

## 8. Security checklist (OWASP ASVS L2 as the target)

- argon2id (memory ≥ 19 MiB, t=2). Never log passwords. Use the same generic message for a wrong username or password.
- Session cookie `__Host-kpmpl_sid`, HttpOnly, Secure, SameSite=Lax. Store the hash server-side. Rotate on login.
- RBAC guard on every route, plus a CI test that enumerates routes. A cross-role denial test exists for every write (KPM-NFR-003).
- Input validation with Zod on every body and query, and `whitelist`/strip of unknown fields. Fail on unknown enum values.
- Parameterised queries only (ORM). No string-built SQL.
- Upload hardening (5.9). No public buckets. Downloads only via the authorised endpoint.
- Secrets come only from env or a secret manager; commit `.env.example` only. Rotate the DB and bucket credentials at handover.
- Dependency scanning (`npm audit`, Dependabot), container scan (Trivy) in CI.
- Audit log: append-only DB permissions. Log admin actions, logins, failed logins and permission denials.
- Demo mode: the seed with synthetic users and quick-login only when `APP_MODE=demo`. **Impossible in production builds**: the app refuses to start if `APP_MODE=demo` and `NODE_ENV=production`.
- No real KPMPL data in seeds, tests or logs (KPM-NFR-006).

---

## 9. Reliability, operations and observability

- `GET /healthz` (process up) and `GET /readyz` (DB + storage reachable).
- Structured logs with `requestId`, which is returned in every error envelope and echoed in the `X-Request-Id` header.
- Backups:
  - Postgres daily full backup + WAL/PITR (managed DB snapshots acceptable), with bucket versioning on.
  - **Do a restore drill before go-live** (doc 10 §3): restore the DB and one PDF into staging, and document it in `RUNBOOK.md`.
  - The actual RPO/RTO is pending client agreement, so do not claim a figure.
- Migrations run as a separate step (`prisma migrate deploy`) and must be backward compatible.
- Graceful shutdown: drain in-flight requests.
- Clock: inject a `Clock` service so tests can fix the time. "Today" uses Asia/Kolkata.
- Seed data for demo/staging reproduces the frontend fixtures (doc 15 / `src/api/mock/fixtures.ts`): 4 demo visits in different states, 2 packages, 5 synthetic users (`demo-gate, demo-qc, demo-docs, demo-ho, demo-admin`, password from env `DEMO_PASSWORD`).

---

## 10. Frontend switch-over (small, listed changes only)

1. Set `VITE_API_MODE=http` and `VITE_API_BASE_URL`. The mock adapter stays for offline demos.
2. `attachFile` in `httpAdapter.ts`: send `FormData` (category + file) instead of JSON metadata. Remove the in-browser blob store and point the PDF viewer at `GET /document-files/{id}/content`.
3. Add the `X-Requested-With: kpmpl-web` header in `call()`.
4. Add a change-password screen (for the first login after an admin creates the user or resets the password).
5. Show the one-time `temporaryPassword` after create user and reset password, in Users & Access.
6. Hide the "Demo data is kept in this tab only" banner and the demo role picker when `APP_MODE != demo`.
7. Overview CSV: switch to the server endpoint.

Record each change in `CONTRACT_CHANGES.md`.

---

## 11. Open KPMPL decisions: implement as policies, never hard-code

| Ref | Topic | Prototype default the backend uses |
|---|---|---|
| D-01 / D-11 / KPM-X-003 | Gate Entry uniqueness, GRN ↔ invoice cardinality | Exact-string unique Gate Entry; GRN may repeat across visits (noted) |
| D-02 | QC formulas, deductions | None. `not_configured` |
| D-03 | Who decides QC outcomes | **Decided 2026-11-03 (KPMPL):** the QC Operator (`qc`, capability `qc.decide`) records readings and the final decision |
| D-04 | Exit eligibility | tare + QC readings submitted + mill-checks confirmation |
| D-05 | Mandatory documents, waivers | 6 candidate rows; each attached or N/A with reason |
| D-06 | HO return/hold process | correction_requested → resubmitted loop |
| D-07 | Real staff, roles | Synthetic users; role matrix in DB |
| D-08 | ERP milestone set, who may reverse | 3 ordered milestones; erp.confirm can reverse with a reason |
| D-09 | Reminder recipient/channel | In-app log only |
| D-10 | Report columns | Current frontend CSV columns |
| D-12 | Weight precision, post-exit corrections | 3 decimals kg; locked after exit |

---

## 12. Acceptance test suite (the definition of done)

Write these as automated integration tests against real Postgres and MinIO (Testcontainers). Each test is named with its rule ID.

1. **Auth.** Login/logout/me. A wrong password and an unknown user get the same 401. Lockout after repeated failures. A deactivated user cannot log in and their existing session dies.
2. **RBAC matrix.** For every write endpoint × every role: allowed roles succeed, others get 403. HO cannot read a draft package (404). A CI test fails if any route lacks a guard.
3. **Golden path M1** (gate → qc operator: readings + decision → gate):
   - create visit → QC draft → QC submit → QC decision `returned` → resubmit with reason → QC decision `accepted` → tare → exit → GRN.
   - Assert all three status domains, `version` increments, and the timeline contains every event in order with the correct actor and source.
4. **Golden path M2**:
   - Gate creates a package with 2 trucks of the same supplier.
   - It uploads a real PDF, which is scanned clean.
   - It marks 5 rows N/A, then marks the package ready.
   - Docs authority sends it.
   - HO starts the review, checks the file, requests a correction.
   - Gate replaces the file; docs resubmits with a note.
   - HO checks and verifies.
   - HO confirms the 3 milestones in order, reverses posting, and logs a reminder (rejected after approval).
   - The PDF downloads for HO and is denied for QC.
5. **Cross-user visibility** (the bug the client hit):
   - User A (gate) creates a visit on client 1.
   - User B (docs) on client 2, User C (ho) on client 3 and User D (admin) on client 4 each fetch it immediately via their endpoints.
   - All four see the same data and version.
6. **Every rule R-01 … R-22**: one test for the success case and one test per blocking condition, asserting the exact `code`, `fields` keys and message.
7. **Idempotency.** The same key replays without creating a duplicate (visit, package, upload, milestone). The same key with a different body gets 422.
8. **Concurrency.**
   - Two parallel writes with the same `If-Match` give exactly one success and one `VERSION_CONFLICT`.
   - 20 parallel `createVisit` calls with the same Gate Entry No. give exactly 1 created and 19 `DUPLICATE_CANDIDATE`.
   - Two packages claiming the same truck give exactly 1 success.
9. **Atomicity.** Inject a failure after the domain write and before commit. Assert that nothing persisted (no row, no audit, no idempotency record).
10. **Decimals and refs.**
    - `"0008-HO"` and `"00071-HO"` round-trip byte-for-byte.
    - `"15000.000"` stays a string.
    - Floats are rejected (`15000.0001` → 422).
    - Net is never stored.
11. **Uploads.**
    - A non-PDF renamed `.pdf` → 422.
    - An 11 MB file → 422.
    - The EICAR test string → `infected`, not served.
    - The bucket is not publicly readable.
12. **Audit.** UPDATE and DELETE on `audit_event` fail at the DB level. Every correction has before, after and reason.
13. **Frontend E2E.** Run the existing UI against the real API with Playwright, in one browser context per role, all at the same time, and repeat the "Golden path M2". Then **reload every tab and verify the data is still there.**

Coverage target: ≥ 90 % lines on `modules/*/domain` and services. CI must be green.

---

## 13. Milestones (stop and report after each)

1. **Foundation:** repo, Docker Compose, config, envelope and errors, request ID, idempotency, versioning, audit module, auth and sessions, RBAC from DB, users admin, health checks, CI, OpenAPI. Tests: 1, 2, 7 (partial), 12.
2. **Module 1:** receiving, corrections, reference data, timeline, weighment, exit, GRN, QC (submit + demo review + queues), overview, CSV. Tests: 3, 5, 6 (R-01…R-08), 8, 9, 10.
3. **Module 2:** packages, checklist, uploads with scanning and secure download, gate actions, HO review, ERP milestones, reminders. Tests: 4, 6 (R-09…R-21), 11.
4. **Integration and hardening:** frontend switch-over (Section 10), Playwright E2E (test 13), security review against Section 8, load sanity (10 users / 5 concurrent sessions at a realistic pace), backup and restore drill, `RUNBOOK.md`, deployment to a client-owned staging environment.

Each report must list: what was built, test results (pass/fail counts), any deviation from this brief and why, and the open decisions defaulted.

---

## 14. Things the agent must NOT do

- Do not connect to DataMan, scrape it, or store any DataMan credentials.
- Do not send emails, SMS or WhatsApp messages.
- Do not invent QC formulas, deduction values, mandatory documents or approval authority.
- Do not store weights as floats or ERP refs as numbers.
- Do not let the UI decide permissions, and do not trust any client-sent role, user ID or timestamp for "recordedAt" (server time only; staff-reported event times are stored separately as given).
- Do not delete or overwrite history.
- Do not commit secrets or real client data. Do not push to `main` without review.
- Do not mark the work "done" without the Section 12 suite passing, and say exactly what was and was not tested.
