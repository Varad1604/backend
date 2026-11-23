import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { ErpSqlServerController } from '../erp-sql-server.controller';

const row = (over: Record<string, unknown> = {}) => ({
  DocId: 'DHOGate  2026    6450', V_No: '17110013',
  V_Date: new Date('2026-11-17'), V_Time: '1900-01-01T09:15:00.000Z',
  VehicleNo: 'MH15JC1667', PartyCode: 'P-123',
  grossWeight: 16.42, grnUnit: 'MT',
  ...over,
});
const setup = () => {
  const executeQuery = vi.fn();
  const logger = { error: vi.fn() };
  const controller = new ErpSqlServerController({ executeQuery, logger } as any);
  const reply: any = { code: vi.fn().mockReturnThis() };
  const req: any = { id: 'lookup-test' };
  return { controller, executeQuery, reply, req };
};

describe('GET /erp/gate-lookup — safe shared ERP prefill source', () => {
  it('returns only verified candidate fields and exact MT → kg from GRN evidence', async () => {
    const t = setup(); t.executeQuery.mockResolvedValue([row()]);
    const body: any = await t.controller.lookupGate(t.reply, t.req, '17110013', '2026');
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toEqual({
      docId: 'DHOGate  2026    6450', gateNo: '17110013',
      gateDate: new Date('2026-11-17'), gateTime: '1900-01-01T09:15:00.000Z',
      vehicleNo: 'MH15JC1667', partyCode: 'P-123',
      grossWeight: { value: '16420', unit: 'kg', provenance: 'grn' },
    });
    expect(body.data[0].supplierDisplayName).toBeUndefined();
    expect(body.data[0].materialDisplayName).toBeUndefined();
    expect(body.meta.truncated).toBe(false);
    expect(t.reply.code).not.toHaveBeenCalled();
  });

  it('uses bound gate-number and year-range parameters; never interpolates untrusted input', async () => {
    const t = setup(); t.executeQuery.mockResolvedValue([]);
    const attack = "17110013' OR 1=1 --";
    await t.controller.lookupGate(t.reply, t.req, attack, '2026');
    const [sql, params] = t.executeQuery.mock.calls[0]!;
    expect(sql).toContain('g.V_No = @gateNo');
    expect(sql).toContain('g.V_Date >= @fromDate AND g.V_Date < @toDate');
    expect(sql).not.toContain(attack);
    expect(params).toEqual([
      { name: 'gateNo', type: 'VarChar', value: attack },
      { name: 'fromDate', type: 'VarChar', value: '2026-01-01' },
      { name: 'toDate', type: 'VarChar', value: '2027-01-01' },
    ]);
    expect(sql).not.toMatch(/INSERT\s|UPDATE\s|DELETE\s/i);
  });

  it('does not invent kilograms or a supplier name when ERP unit evidence is absent', async () => {
    const t = setup(); t.executeQuery.mockResolvedValue([row({ grossWeight: 22.11, grnUnit: null, PartyCode: null })]);
    const body: any = await t.controller.lookupGate(t.reply, t.req, '17110013', '2026');
    expect(body.data[0].grossWeight).toEqual({ value: '22.11', unit: null, provenance: 'unverified' });
    expect(body.data[0].partyCode).toBeNull();
  });

  it('returns all distinct candidates by full DocId (never guesses which gate number matches)', async () => {
    const t = setup(); t.executeQuery.mockResolvedValue([row(), row({ DocId:'DHOGate  2026    6451' })]);
    const body: any = await t.controller.lookupGate(t.reply, t.req, '17110013', '2026');
    expect(body.data.map((x: any) => x.docId)).toEqual(['DHOGate  2026    6450','DHOGate  2026    6451']);
  });

  it('marks truncated results so a caller cannot silently pick a candidate', async () => {
    const t = setup(); t.executeQuery.mockResolvedValue(Array.from({ length: 21 }, (_, i) => row({ DocId: String(i) })));
    const body: any = await t.controller.lookupGate(t.reply, t.req, '17110013', '2026');
    expect(body.data).toHaveLength(20); expect(body.meta.truncated).toBe(true);
  });

  it('rejects an empty gate number, control characters, and invalid years before any SQL request', async () => {
    const t = setup();
    await expect(t.controller.lookupGate(t.reply, t.req, '', '2026')).rejects.toBeInstanceOf(BadRequestException);
    await expect(t.controller.lookupGate(t.reply, t.req, '1\n2', '2026')).rejects.toBeInstanceOf(BadRequestException);
    await expect(t.controller.lookupGate(t.reply, t.req, '17110013', '26')).rejects.toBeInstanceOf(BadRequestException);
    await expect(t.controller.lookupGate(t.reply, t.req, '17110013', '1999')).rejects.toBeInstanceOf(BadRequestException);
    expect(t.executeQuery).not.toHaveBeenCalled();
  });

  it('returns a 503 error and never a false empty list if DataMan is unavailable', async () => {
    const t = setup(); t.executeQuery.mockRejectedValue(new Error('ERP connection unavailable'));
    const body: any = await t.controller.lookupGate(t.reply, t.req, '17110013', '2026');
    expect(t.reply.code).toHaveBeenCalledWith(503);
    expect(body.error.code).toBe('ERP_UNAVAILABLE');
    expect(body.data).toBeUndefined();
  });
});

describe('gate lookup error classification — fallback only for real ERP outage', () => {
  it('rejects malformed SQL as an internal defect, never an authorized outage fallback', async () => {
    const t = setup();
    t.executeQuery.mockRejectedValue(Object.assign(new Error("Invalid column name 'BadColumn'"), { code: 'EREQUEST' }));
    const body: any = await t.controller.lookupGate(t.reply, t.req, '17110013', '2026');
    expect(t.reply.code).toHaveBeenCalledWith(500);
    expect(body.error.code).toBe('ERP_QUERY_FAILED');
    expect(body.error.meta.retryable).toBe(false);
  });

  it('does not enable manual fallback for ERP credential failures', async () => {
    const t = setup();
    t.executeQuery.mockRejectedValue(Object.assign(new Error('Login failed'), { code: 'ELOGIN' }));
    const body: any = await t.controller.lookupGate(t.reply, t.req, '17110013', '2026');
    expect(t.reply.code).toHaveBeenCalledWith(500);
    expect(body.error.code).toBe('ERP_QUERY_FAILED');
  });

  it('keeps timeouts and socket outages as 503 for reason-controlled manual handling', async () => {
    const t = setup();
    t.executeQuery.mockRejectedValue(Object.assign(new Error('Request timed out'), { code: 'ETIMEOUT' }));
    const body: any = await t.controller.lookupGate(t.reply, t.req, '17110013', '2026');
    expect(t.reply.code).toHaveBeenCalledWith(503);
    expect(body.error.code).toBe('ERP_UNAVAILABLE');
    expect(body.error.meta.retryable).toBe(true);
  });
});
