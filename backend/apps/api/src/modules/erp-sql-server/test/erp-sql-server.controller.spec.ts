import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ErpSqlServerController } from '../erp-sql-server.controller';
import { ErpQueryParam } from '../erp-sql-server.service';

/**
 * Phase 05A/06 acceptance tests for the ERP controller contract.
 * The service is mocked: these tests assert the SQL/pagination/DTO/HTTP contract that
 * the frontend depends on. They are NOT live ERP integration tests.
 *
 * Phase 06 defect the mocks must never hide again: the app runs on the Fastify adapter,
 * whose reply object has no `.status()/.json()` (Express API). The controller therefore
 * RETURNS bodies and throws Nest HttpExceptions; a mocked Express `res` made the old
 * tests pass while every real ERP request failed with a 500 TypeError.
 */

/** Fastify-like reply: exposes only what a FastifyReply guarantees for this controller. */
const makeReply = () => {
  const reply: any = {};
  reply.code = vi.fn(() => reply);
  return reply;
};
const makeReq = () => ({ id: 'req-test-id' }) as any;

const statusOf = (reply: any): number | undefined => reply.code.mock.calls[0]?.[0];

const errorOf = async (call: Promise<unknown>): Promise<{ status: number; body: any }> => {
  try {
    await call;
  } catch (error) {
    if (error instanceof BadRequestException || error instanceof NotFoundException) {
      return { status: error.getStatus(), body: error.getResponse() };
    }
    throw error;
  }
  throw new Error('expected the controller to throw an HttpException');
};

describe('ErpSqlServerController (contract tests, mocked service)', () => {
  let controller: ErpSqlServerController;
  let executeQuery: ReturnType<typeof vi.fn>;
  let executeScalar: ReturnType<typeof vi.fn>;
  let logger: { error: (...a: unknown[]) => void; log: (...a: unknown[]) => void; debug: (...a: unknown[]) => void; warn: (...a: unknown[]) => void };

  const sqlOf = (fn: ReturnType<typeof vi.fn>, call = 0) => String(fn.mock.calls[call]?.[0]);
  const paramsOf = (fn: ReturnType<typeof vi.fn>, call = 0): ErpQueryParam[] => fn.mock.calls[call]?.[1] as ErpQueryParam[];

  const gateRow = (over: Record<string, unknown> = {}) => ({
    DocId: 'GI-1', V_Type: 'GRN', V_No: 'V-1', V_Date: new Date('2026-11-01T00:00:00Z'),
    V_Time: '1900-01-01T09:30:00.000Z', PartyCode: 'P-1', VehicleNo: 'MH-01-AA-1111',
    GateOutDate: new Date('2026-11-01T10:00:00Z'),
    wDocId: 'W-1', grossWeight: 12500.5, tareWeight: 4200.25, netWeight: 8300.25,
    pDocId: 'PC-1', pVType: 'PCHLG', grnDate: new Date('2026-11-02T00:00:00Z'), grnApprovalStatus: 'APPROVED',
    ...over,
  });

  beforeEach(() => {
    executeQuery = vi.fn();
    executeScalar = vi.fn();
    logger = { error: vi.fn(), log: vi.fn(), debug: vi.fn(), warn: vi.fn() };
    const service: any = { executeQuery, executeScalar, logger };
    service['logger'] = logger;
    controller = new ErpSqlServerController(service);
  });

  describe('GET /erp/gate-entries', () => {
    it('returns a serializable body instead of calling Express res.json (Phase 06 regression)', async () => {
      executeScalar.mockResolvedValue(1);
      executeQuery.mockResolvedValue([gateRow()]);
      const reply = makeReply();

      const body = await controller.listGateEntries(reply, makeReq(), '1', '20');

      // A FastifyReply has no .json(); the controller must not reach for one.
      expect((reply as any).json).toBeUndefined();
      expect(typeof body).toBe('object');
      expect(Array.isArray((body as any).data)).toBe(true);
      expect(statusOf(reply)).toBeUndefined(); // success keeps the default 200
    });

    it('paginates per gate entry with ROW_NUMBER and a correct window predicate', async () => {
      executeScalar.mockResolvedValue(5);
      executeQuery.mockResolvedValue([gateRow()]);

      await controller.listGateEntries(makeReply(), makeReq(), '2', '20');

      const dataSql = sqlOf(executeQuery);
      expect(dataSql).toContain('ROW_NUMBER() OVER');
      expect(dataSql).toContain('gp.rn > @skip AND gp.rn <= @skip + @limit');
      // A CTE that references `rn` without defining it is a guaranteed SQL error.
      expect(dataSql).toMatch(/ROW_NUMBER\(\) OVER \(ORDER BY [^)]+\) AS rn/);

      const params = paramsOf(executeQuery);
      expect(params.find((p) => p.name === 'skip')?.value).toBe(20);
      expect(params.find((p) => p.name === 'limit')?.value).toBe(20);
    });

    it('counts GateInOut only, so joined rows cannot inflate the total', async () => {
      executeScalar.mockResolvedValue(3);
      executeQuery.mockResolvedValue([gateRow()]);

      const body: any = await controller.listGateEntries(makeReply(), makeReq(), '1', '20');

      const countSql = sqlOf(executeScalar);
      expect(countSql).toContain('FROM GateInOut g');
      expect(countSql).not.toContain('JOIN');
      // Pagination params must not leak into the count statement.
      expect(paramsOf(executeScalar)).toEqual([]);
      expect(body.meta.total).toBe(3);
    });

    it('clamps pagination to safe bounds', async () => {
      executeScalar.mockResolvedValue(0);
      executeQuery.mockResolvedValue([]);

      const body: any = await controller.listGateEntries(makeReply(), makeReq(), '-4', '5000');

      const params = paramsOf(executeQuery);
      expect(params.find((p) => p.name === 'skip')?.value).toBe(0);
      expect(params.find((p) => p.name === 'limit')?.value).toBe(100);
      expect(body.meta.page).toBe(1);
      expect(body.meta.limit).toBe(100);
    });

    it('binds docId and vType filters as named parameters (no interpolation)', async () => {
      executeScalar.mockResolvedValue(1);
      executeQuery.mockResolvedValue([gateRow()]);

      await controller.listGateEntries(makeReply(), makeReq(), '1', '20', "GI-1' OR 1=1 --", 'PCHLG');

      const dataSql = sqlOf(executeQuery);
      expect(dataSql).toContain('g.DocId = @docId');
      expect(dataSql).toContain('ch.V_Type = @vType');
      expect(dataSql).not.toContain("GI-1' OR 1=1");
      const params = paramsOf(executeQuery);
      expect(params.find((p) => p.name === 'docId')?.value).toBe("GI-1' OR 1=1 --");
      expect(params.find((p) => p.name === 'vType')?.value).toBe('PCHLG');
    });

    it('collapses join fan-out and reports weighment/GRN presence with kg units', async () => {
      executeScalar.mockResolvedValue(1);
      executeQuery.mockResolvedValue([
        gateRow({ wDocId: 'W-1', pDocId: 'PC-1' }),
        gateRow({ wDocId: 'W-2', pDocId: 'PC-1' }),
        gateRow({ wDocId: 'W-1', pDocId: 'PC-2' }),
      ]);

      const body: any = await controller.listGateEntries(makeReply(), makeReq(), '1', '20');

      expect(body.data).toHaveLength(1);
      expect(body.data[0].hasWeighment).toBe(true);
      expect(body.data[0].hasGrn).toBe(true);
      expect(body.data[0].grossWeight).toEqual({ value: '12500.5', unit: 'kg' });
      expect(body.data[0].netWeight).toEqual({ value: '8300.25', unit: 'kg' });
    });

    it('returns 200 with an empty list for a legitimately empty result', async () => {
      executeScalar.mockResolvedValue(0);
      executeQuery.mockResolvedValue([]);
      const reply = makeReply();

      const body: any = await controller.listGateEntries(reply, makeReq(), '1', '20');

      expect(statusOf(reply)).toBeUndefined();
      expect(body.data).toEqual([]);
      expect(body.meta.totalPages).toBe(0);
    });

    it('returns 503 with the standard error envelope when the ERP is unavailable', async () => {
      executeScalar.mockRejectedValue(new Error('TLS/SSL certificate error'));
      const reply = makeReply();

      const body: any = await controller.listGateEntries(reply, makeReq(), '1', '20');

      expect(statusOf(reply)).toBe(503);
      // Standard envelope: error is an OBJECT with a code the frontend can read.
      expect(typeof body.error).toBe('object');
      expect(body.error.code).toBe('ERP_UNAVAILABLE');
      expect(body.error.message).toBe('ERP data source temporarily unavailable.');
      expect(body.error.meta).toEqual({ retryable: true, source: 'erp.sql.server.gate-entries.list' });
      expect(body.error.requestId).toBe('req-test-id');
      expect(body.data).toBeUndefined();
    });

    it('queries only verified DataMan columns', async () => {
      executeScalar.mockResolvedValue(0);
      executeQuery.mockResolvedValue([]);

      await controller.listGateEntries(makeReply(), makeReq(), '1', '20');

      const sql = `${sqlOf(executeScalar)} ${sqlOf(executeQuery)}`;
      for (const invented of ['SupplierName', 'MaterialDesc', 'QCStatus', 'ExitStatus', 'GrnRef', 'ArrivalTime', 'w.Kind', 'w.unit']) {
        expect(sql).not.toContain(invented);
      }
      for (const verified of ['g.DocId', 'g.V_Date', 'g.PartyCode', 'g.VehicleNo', 'g.GateOutDate',
        'w.Actual_GWeight', 'w.Tare_Weight', 'w.Net_Weight', 'p.GRN_Date', 'p.ApprovalStatus']) {
        expect(sql).toContain(verified);
      }
    });

    it('never labels weights in an invented unit', async () => {
      executeScalar.mockResolvedValue(1);
      executeQuery.mockResolvedValue([gateRow()]);

      const body = await controller.listGateEntries(makeReply(), makeReq(), '1', '20');

      const json = JSON.stringify(body);
      expect(json).not.toContain('tons');
      expect(json).toContain('"unit":"kg"');
    });
  });

  describe('GET /erp/gate-entries/:docId', () => {
    it('throws a 400 HttpException for an empty DocId', async () => {
      const { status, body } = await errorOf(controller.readGateEntry(makeReply(), makeReq(), '   '));

      expect(status).toBe(400);
      expect(body.code).toBe('VALIDATION_FAILED');
      expect(body.fields).toEqual({ docId: 'Must provide a valid GateInOut.DocId' });
    });

    it('throws a 404 HttpException when the gate entry does not exist', async () => {
      executeQuery.mockResolvedValue([]);

      const { status, body } = await errorOf(controller.readGateEntry(makeReply(), makeReq(), 'MISSING-1'));

      expect(status).toBe(404);
      expect(body.code).toBe('NOT_FOUND');
      expect(body.message).toContain('MISSING-1');
      expect(body.meta).toEqual({ source: 'erp.sql.server.gate-entry.read' });
    });

    it('aggregates multiple weighment and GRN rows instead of truncating to the first', async () => {
      executeQuery.mockResolvedValue([
        gateRow({ wDocId: 'W-1', pDocId: 'PC-1', weighSlipNo: 'WS-1', grossWeight: 12500.5, tareWeight: 4200.25, netWeight: 8300.25, weighDate: new Date('2026-11-01T09:00:00Z'), weighDateOut: null, pVNo: 'PV-1' }),
        gateRow({ wDocId: 'W-2', pDocId: 'PC-2', weighSlipNo: 'WS-2', grossWeight: 12400, tareWeight: 4100, netWeight: 8300, weighDate: new Date('2026-11-01T09:30:00Z'), weighDateOut: null, pVNo: 'PV-2' }),
      ]);

      const body: any = await controller.readGateEntry(makeReply(), makeReq(), 'GI-1');

      const dto = body.data;
      expect(dto.weighments).toHaveLength(2);
      expect(dto.grns).toHaveLength(2);
      expect(dto.hasWeighment).toBe(true);
      expect(dto.hasGrn).toBe(true);
      expect(dto.weighments[1].weighSlipNo).toBe('WS-2');
      expect(dto.weighments[0].netWeight).toEqual({ value: '8300.25', unit: 'kg' });
    });

    it('reports a gate entry without weighment or GRN as explicit empty state, not an error', async () => {
      executeQuery.mockResolvedValue([
        gateRow({ wDocId: null, grossWeight: null, tareWeight: null, netWeight: null,
          pDocId: null, pVType: null, grnDate: null, grnApprovalStatus: null }),
      ]);

      const body: any = await controller.readGateEntry(makeReply(), makeReq(), 'GI-1');

      const dto = body.data;
      expect(dto.hasWeighment).toBe(false);
      expect(dto.hasGrn).toBe(false);
      expect(dto.weighments).toEqual([]);
      expect(dto.grns).toEqual([]);
      expect(dto.grossWeight).toBeNull();
      expect(dto.tareWeight).toBeNull();
      expect(dto.netWeight).toBeNull();
    });

    it('returns 503 when the ERP read fails', async () => {
      executeQuery.mockRejectedValue(new Error('Login failed for user pravahax_readonly'));
      const reply = makeReply();

      const body: any = await controller.readGateEntry(reply, makeReq(), 'GI-1');

      expect(statusOf(reply)).toBe(503);
      expect(body.error.code).toBe('ERP_UNAVAILABLE');
      expect(body.error.requestId).toBe('req-test-id');
    });
  });
});
