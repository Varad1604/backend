import { describe, expect, it, vi } from 'vitest';
import { ErpWorkflowReadController } from '../erp-workflow-read.controller';
import { roleCapabilities } from '../../identity-access/policy';

const setup = () => {
  const executeQuery = vi.fn();
  const controller = new ErpWorkflowReadController({ executeQuery } as any);
  return { controller, executeQuery };
};

describe('KPMPL role-scoped DataMan SELECT-only ERP integration', () => {
  it('limits purchase-bill fields to Accountant and serves operational facts to receiving roles', () => {
    expect(Reflect.getMetadata('kpmpl.capability', ErpWorkflowReadController.prototype.feed)).toBe('receiving.view');
    expect(Reflect.getMetadata('kpmpl.capability', ErpWorkflowReadController.prototype.facts)).toBe('receiving.view');
    expect(Reflect.getMetadata('kpmpl.capability', ErpWorkflowReadController.prototype.bills)).toBe('accounting.inbox');
    expect(roleCapabilities.accountant).toContain('accounting.inbox');
    for (const role of ['gate', 'gate_doc', 'gate_doc_authority', 'qc', 'ho', 'admin'] as const) {
      expect(roleCapabilities[role]).toContain('receiving.view');
      expect(roleCapabilities[role]).not.toContain('accounting.inbox');
    }
  });

  it('delivers a fresh bounded live feed with an authoritative source label, not seeded data', async () => {
    const t = setup();
    t.executeQuery.mockResolvedValue([{
      docId: 'DHOGate 2026 1', gateNo: '18110001', gateDate: '2026-11-18',
      supplierName: 'Valid DataMan Supplier', supplierDisplayName: 'Valid DataMan Supplier',
      rawGrnApprovalStatus: null,
    }]);
    const res = await t.controller.feed('25');
    expect(res.data).toHaveLength(1);
    expect(res.data[0]!.supplierDisplayName).toBe('Valid DataMan Supplier');
    expect(res.data[0]!.rawGrnApprovalStatus).toBeNull();
    expect(res.meta.source).toBe('dataman.readonly.gate-feed');
    expect(new Date(res.meta.fetchedAt).getTime()).toBeGreaterThan(0);
    const [sql, params] = t.executeQuery.mock.calls[0]!;
    expect(sql).toContain('SELECT TOP (@take)');
    expect(params).toEqual([{name:'take',type:'Int',value:25}]);
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|MERGE|DROP|EXEC|ALTER)\s/i);
  });

  it('never accepts a limitless feed', async () => {
    const t = setup();
    await expect(t.controller.feed('1000')).rejects.toMatchObject({ status: 400 });
    await expect(t.controller.feed('garbage')).rejects.toMatchObject({ status: 400 });
    expect(t.executeQuery).not.toHaveBeenCalled();
  });

  it('reads full DocId supplier, GRN lines, unit-provenanced weights and raw approval fields', async () => {
    const t = setup();
    t.executeQuery
      .mockResolvedValueOnce([{
        DocId: 'DHOGate 2026 1', V_No: '18110001', VehicleNo: 'MH10AB1111',
        supplierDisplayName: 'Known Supplier', grossRaw: 16.42, grnUnit: 'MT',
      }])
      .mockResolvedValueOnce([{
        grnDocId: 'GRN-DOC-ID', grnNo: '18110005', grnDate: '2026-11-18',
        lineNumber: 1, itemCode: 'ITEM1', materialDisplayName: 'STEAM COAL',
        lineUnit: 'MT', documentQty: '7', poDocId: 'PO-DOC-ID', poNo: '1345',
        rawApprovalStatus: null, approvedDate: null,
      }]);
    const res = await t.controller.facts('DHOGate 2026 1');
    expect(res.data.supplierDisplayName).toBe('Known Supplier');
    expect(res.data.grnLines).toHaveLength(1);
    expect(res.data.grnLines[0]!.poNo).toBe('1345');
    expect(res.data.grnLines[0]!.rawApprovalStatus).toBeNull();
    expect(res.data.grossWeight).toEqual({ value:'16420', unit:'kg', provenance:'grn' });
    const [gateSql, params] = t.executeQuery.mock.calls[0]!;
    expect(gateSql).toContain('WHERE g.DocId=@docId');
    expect(params).toEqual([{name:'docId',type:'VarChar',value:'DHOGate 2026 1'}]);
  });

  it('does not fabricate a verified weight/unit or a GRN when evidence is missing', async () => {
    const t = setup();
    t.executeQuery.mockResolvedValueOnce([{
      DocId: 'G1', V_No: '1', grossRaw: 16.42, grnUnit: null,
    }]).mockResolvedValueOnce([]);
    const res = await t.controller.facts('G1');
    expect(res.data.grnLines).toEqual([]);
    expect(res.data.grossWeight?.unit).toBeNull();
    expect(res.data.grossWeight?.provenance).toBe('unverified');
  });

  it('rejects invalid or unknown full ERP identities', async () => {
    const t = setup();
    await expect(t.controller.facts('abc\nxyz')).rejects.toMatchObject({status:400});
    expect(t.executeQuery).not.toHaveBeenCalled();
    t.executeQuery.mockResolvedValueOnce([]);
    await expect(t.controller.facts('unknown')).rejects.toMatchObject({status:404});
  });

  it('Accountant bill view uses the verified GRN line path and never claims ERP posting', async () => {
    const t = setup();
    t.executeQuery.mockResolvedValue([{
      billDocId: 'B-1', billNo: '1301', billDate: '2027-03-01',
      netAmount: 50000.5, rawApprovalStatus: null, approvedDate: '2026-10-27',
    }]);
    const res = await t.controller.bills('DHOGate 2026 1');
    expect(res.data[0]!.billDate).toBe('2027-03-01');
    expect(res.data[0]!.rawApprovalStatus).toBeNull();
    expect(res.data[0]!.netAmount).toBe('50000.5');
    expect(res.meta.postingVerified).toBe(false);
    const [sql,params] = t.executeQuery.mock.calls[0]!;
    expect(sql).toContain('pc.DocId=bd.PCHLDocId');
    expect(sql).toContain('pc.GIDocId=@docId');
    expect(params).toEqual([{name:'docId',type:'VarChar',value:'DHOGate 2026 1'}]);
  });

  it('fails closed instead of returning empty demo records when DataMan fails', async () => {
    const t = setup();
    t.executeQuery.mockRejectedValueOnce(Object.assign(new Error('Connection timed out'),{code:'ETIMEOUT'}));
    await expect(t.controller.feed('10')).rejects.toMatchObject({ status:503 });
    t.executeQuery.mockRejectedValueOnce(Object.assign(new Error('Invalid column'),{code:'EREQUEST'}));
    await expect(t.controller.facts('G1')).rejects.toMatchObject({ status:500 });
  });
});
