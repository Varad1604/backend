/**
 * Contract drift test (Phase 1 step 4, option a): the frontend's mock fixtures — the
 * same objects the UI renders in demo mode — are validated against the generated
 * backend OpenAPI document (`openapi.yaml`). If the backend contract and the frontend
 * types drift, this test fails in CI before either side ships.
 *
 * The YAML is a generated copy of `backend/packages/contracts/openapi/openapi.yaml`;
 * refresh it only by re-copying from the backend repo.
 */
import Ajv2020 from 'ajv/dist/2020';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { buildFixtures } from '../mock/fixtures';
import { RECEIVING_CSV_COLUMNS } from '../mock/mockAdapter';
import type { DocumentPackageView, Page, QcInspection, QcQueueItem, ReceivingVisit } from '../../domain/types';
// Vite injects the file contents at build time (no node:fs in the browser tsconfig).
import contractYaml from './openapi.yaml?raw';

const doc = parse(contractYaml) as {
  paths: Record<string, unknown>;
  components: { schemas: Record<string, object> };
};

// Formats (uuid, date-time) are intentionally not validated: fixture ids are demo
// strings ("demo-visit-001") and the ISO-8601 shape is already covered by typecheck.
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
// Compile the whole document once so `#/components/schemas/…` refs resolve.
const ROOT_ID = 'https://kpmpl.local/contract';
ajv.addSchema({ $id: ROOT_ID, ...doc });
const validator = (name: string) => {
  const validate = ajv.getSchema(`${ROOT_ID}#/components/schemas/${name}`);
  if (!validate) throw new Error(`schema ${name} missing from openapi.yaml`);
  return validate;
};
const expectValid = (name: string, value: unknown) => {
  const validate = validator(name);
  const ok = validate(value);
  if (!ok) throw new Error(`${name} invalid: ${ajv.errorsText(validate.errors)}`);
};

describe('frontend fixtures against the generated backend contract', () => {
  const db = buildFixtures();
  const visits: ReceivingVisit[] = db.visits;
  const views: DocumentPackageView[] = db.packages.map((pkg) => ({
    ...pkg,
    visits: db.visits.filter((visit) => pkg.visitIds.includes(visit.id)),
  }));
  const inspections: QcInspection[] = db.inspections;

  it('declares every adapter endpoint including the QC decision route', () => {
    const paths = Object.keys(doc.paths);
    // D-03 (2026-11-03): the QC operator decides from the QC queue; there is no separate decision queue.
    expect(paths).not.toContain('/qc/review-queue');
    expect(paths).toContain('/qc-inspections/{inspectionId}/decisions');
    expect(paths).toContain('/reports/receiving.csv');
    expect(paths).toContain('/document-files/{fileId}/content');
    // 36 adapter calls land on 34 paths (two paths carry both a GET and a write).
    expect(paths.length).toBe(34);
  });

  it('validates every fixture visit as a ReceivingVisit', () => {
    for (const visit of visits) expectValid('ReceivingVisit', visit);
  });

  it('validates every fixture inspection as a QcInspection', () => {
    for (const inspection of inspections) expectValid('QcInspection', inspection);
  });

  it('validates fixture packages (with visits resolved) as DocumentPackageView', () => {
    for (const view of views) expectValid('DocumentPackageView', view);
  });

  it('validates fixture users as User and timeline rows as TimelineEvent', () => {
    for (const user of db.users) expectValid('User', user);
    for (const events of Object.values(db.timeline)) for (const event of events) expectValid('TimelineEvent', event);
  });

  it('validates a paged page payload and a queue item assembled like the adapter reads them', () => {
    const page: Page<ReceivingVisit> = { data: visits.slice(0, 2), page: 1, pageSize: 50, total: visits.length };
    expectValid('VisitPage', page);
    const queueItem: QcQueueItem = { visit: visits[0]!, latestRevision: 1, lastReturnReason: null };
    expectValid('QcQueueItem', queueItem);
  });

  it('keeps the CSV column contract in sync with the document', () => {
    // The backend must emit exactly the frontend's current columns (brief §5.5).
    const header = ['Gate Entry No.', 'Vehicle No.', 'Supplier', 'Material', 'Gross Wt (kg)', 'Tare Wt (kg)', 'Net Wt (kg)', 'QC status', 'Exit status', 'Exit time (IST)', 'GRN status', 'GRN No.', 'Entry time (IST)', 'Entered by'];
    expect(RECEIVING_CSV_COLUMNS).toEqual(header);
    expect(doc.paths['/reports/receiving.csv']).toBeDefined();
  });

  it('pins the request shapes the adapter sends', () => {
    const submit = doc.components.schemas['QcSubmitInput'] as { required?: string[]; properties?: Record<string, { enum?: string[] }> };
    expect(submit.required).toEqual(expect.arrayContaining(['measurements', 'intent']));
    expect(submit.properties?.intent?.enum).toEqual(['draft', 'submit']);
    const create = doc.components.schemas['CreateReceivingVisitInput'] as { required?: string[] };
    expect(create.required).toEqual(expect.arrayContaining(['supplierDisplayName', 'materialDisplayName']));
  });
});
