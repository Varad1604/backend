import { BadRequestException, Controller, Get, HttpException, HttpStatus, Param, Query } from '@nestjs/common';
import { Requires } from '../identity-access/access.decorators';
import { ErpSqlServerService, type ErpQueryParam } from './erp-sql-server.service';
import { normalizeErpWeight } from './erp-weights';

/**
 * Verified DataMan read-only operational facts.
 *
 * DataMan is NEVER written by this controller: SELECT with bound parameters only.
 * KPMPL QC/documents/accounting workflow data remains in its own PostgreSQL.
 *
 * This API exposes no invoice/amount fields to a Gate or QC user. Accountant
 * billing facts require accounting.inbox separately. Raw ERP ApprovalStatus is
 * deliberately NOT translated to Approved/Posted/Paid.
 */
@Controller('erp')
export class ErpWorkflowReadController {
  constructor(private readonly erp: ErpSqlServerService) {}

  private static docId(raw: string): string {
    if (!raw || raw.length > 128 || /[\u0000-\u001f]/.test(raw)) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'A valid full DataMan DocId is required.' });
    }
    return raw;
  }

  private async read<T>(sql: string, params: ErpQueryParam[]): Promise<T[]> {
    try {
      return await this.erp.executeQuery(sql, params);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const code = typeof error === 'object' && error && 'code' in error
        ? String((error as {code?: unknown}).code) : '';
      const outage = /connection pool not initialized|connect|timeout|closed|ECONN|ESOCKET|ETIMEDOUT|unavailable/i.test(msg)
        || ['ETIMEOUT', 'ESOCKET', 'ENOTOPEN', 'ECONNCLOSED'].includes(code);
      throw new HttpException({
        code: outage ? 'ERP_UNAVAILABLE' : 'ERP_QUERY_FAILED',
        message: outage ? 'Live DataMan is unavailable. KPMPL did not substitute demo data.' : 'The DataMan read failed. No substitute data was returned.',
      }, outage ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /** Fresh bounded ERP list for all operational roles. No bill amounts. */
  @Get('live-gate-feed')
  @Requires('receiving.view')
  async feed(@Query('limit') rawLimit?: string) {
    const num = Number(rawLimit ?? '20');
    if (!Number.isInteger(num) || num < 1 || num > 50) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'limit must be an integer from 1 to 50.' });
    }
    const rows = await this.read<any>(`
      SELECT TOP (@take) g.DocId AS docId, g.V_No AS gateNo, g.V_Date AS gateDate,
        g.VehicleNo AS vehicleNo, g.PartyCode AS partyCode,
        sg.DisplayName AS supplierDisplayName, sg.Name AS supplierName,
        pc.DocId AS grnDocId, pc.V_No AS grnNo, pc.GRN_Date AS grnDate,
        pc.ApprovalStatus AS rawGrnApprovalStatus, pc.ApprovedDate AS grnApprovedDate
      FROM dbo.GateInOut g
      LEFT JOIN dbo.SubGroup sg ON sg.SubCode=g.PartyCode
      OUTER APPLY (
        SELECT TOP(1) p.DocId,p.V_No,p.GRN_Date,p.ApprovalStatus,p.ApprovedDate
        FROM dbo.PChallan p WHERE p.GIDocId=g.DocId
        ORDER BY p.GRN_Date DESC,p.DocId DESC
      ) pc
      ORDER BY g.V_Date DESC,g.DocId DESC
    `, [{ name: 'take', type: 'Int', value: num }]);
    return {
      data: rows.map((r) => ({
        docId: String(r.docId), gateNo: String(r.gateNo ?? ''),
        gateDate: r.gateDate ?? null, vehicleNo: r.vehicleNo ?? null,
        partyCode: r.partyCode ?? null, supplierDisplayName: r.supplierDisplayName ?? r.supplierName ?? null,
        grnDocId: r.grnDocId ?? null, grnNo: r.grnNo ?? null, grnDate: r.grnDate ?? null,
        rawGrnApprovalStatus: r.rawGrnApprovalStatus ?? null, grnApprovedDate: r.grnApprovedDate ?? null,
      })),
      meta: { source: 'dataman.readonly.gate-feed', fetchedAt: new Date().toISOString(), limit: num },
    };
  }

  /** One exact gate's verified supplier, weighment, GRN lines, material and PO links. */
  @Get('live-gate-facts/:docId')
  @Requires('receiving.view')
  async facts(@Param('docId') rawDocId: string) {
    const docId = ErpWorkflowReadController.docId(rawDocId);
    const param: ErpQueryParam[] = [{ name: 'docId', type: 'VarChar', value: docId }];
    const gateRows = await this.read<any>(`
      SELECT TOP (1) g.DocId,g.V_No,g.V_Date,g.V_Time,g.VehicleNo,g.PartyCode,g.GateOutDate,
        sg.Name AS supplierName,sg.DisplayName AS supplierDisplayName,
        sg.LegalName AS supplierLegalName,
        wFirst.DocId AS weighmentDocId,wFirst.Actual_GWeight AS grossRaw,
        wi.DispName AS preGrnMaterialName,wpo.V_No AS preGrnPoNo,
        wFinal.Out_Tare_Weight AS tareRaw,wFinal.Net_Weight AS documentNetRaw,
        wFinal.Out_Net_Weight AS scaleNetRaw,
        (SELECT CASE WHEN COUNT(DISTINCT pd.Unit)=1 THEN MIN(pd.Unit) ELSE NULL END
         FROM dbo.PChallan pc JOIN dbo.PChallanDetail pd ON pd.DocId=pc.DocId
         WHERE pc.GIDocId=g.DocId AND pd.Unit IS NOT NULL) AS grnUnit
      FROM dbo.GateInOut g
      LEFT JOIN dbo.SubGroup sg ON sg.SubCode=g.PartyCode
      OUTER APPLY (
        SELECT TOP(1) w1.DocId,w1.Actual_GWeight,w1.ItemCode,w1.OrdDocID
        FROM dbo.Weightment w1 WHERE w1.GIDocId=g.DocId
        ORDER BY w1.Weigh_Date ASC,w1.DocId ASC
      ) wFirst
      OUTER APPLY (
        SELECT TOP(1) w2.Out_Tare_Weight,w2.Net_Weight,w2.Out_Net_Weight
        FROM dbo.Weightment w2 WHERE w2.GIDocId=g.DocId
        ORDER BY w2.Weigh_Date DESC,w2.DocId DESC
      ) wFinal
      LEFT JOIN dbo.ItemMast wi ON wi.Code=wFirst.ItemCode
      LEFT JOIN dbo.POrd wpo ON wpo.DocId=wFirst.OrdDocID
      WHERE g.DocId=@docId
    `, param);
    if (!gateRows.length) {
      throw new HttpException({ code: 'NOT_FOUND', message: 'This full gate DocId does not exist in DataMan.' }, 404);
    }
    const g = gateRows[0]!;
    const grnRows = await this.read<any>(`
      SELECT TOP(101) pc.DocId AS grnDocId,pc.V_No AS grnNo,pc.GRN_Date AS grnDate,
        pc.ApprovalStatus AS rawApprovalStatus,pc.ApprovedDate AS approvedDate,
        pc.VerifiedDate AS verifiedDate,
        pd.V_SNo AS lineNumber,pd.ItemCode AS itemCode,
        im.Name AS materialName,im.DispName AS materialDisplayName,
        pd.Unit AS lineUnit,pd.DocQty AS documentQty,pd.RecptQty AS receiptQty,
        pd.AcpQty AS acceptedQty,po.DocId AS poDocId,po.V_No AS poNo,
        po.V_Date AS poDate,po.ApprovalStatus AS rawPoApprovalStatus
      FROM dbo.PChallan pc
      LEFT JOIN dbo.PChallanDetail pd ON pd.DocId=pc.DocId
      LEFT JOIN dbo.ItemMast im ON im.Code=pd.ItemCode
      LEFT JOIN dbo.POrd po ON po.DocId=pd.OrdDocID
      WHERE pc.GIDocId=@docId
      ORDER BY pc.GRN_Date DESC,pc.DocId DESC,pd.V_SNo ASC
    `, param);
    const linesTruncated = grnRows.length > 100;
    const unit = typeof g.grnUnit === 'string' ? g.grnUnit.trim() : null;
    // A missing or mixed GRN unit NEVER becomes kg, even if the raw number looks plausible.
    return {
      data: {
        docId: String(g.DocId), gateNo: String(g.V_No ?? ''),
        gateDate: g.V_Date ?? null, gateTime: g.V_Time ?? null,
        vehicleNo: g.VehicleNo ?? null, gateOutDate: g.GateOutDate ?? null,
        partyCode: g.PartyCode ?? null,
        supplierName: g.supplierName ?? null,
        supplierDisplayName: g.supplierDisplayName ?? g.supplierName ?? null,
        supplierLegalName: g.supplierLegalName ?? null,
        preGrnMaterialName: g.preGrnMaterialName ?? null,
        preGrnPoNo: g.preGrnPoNo ?? null,
        weighmentDocId: g.weighmentDocId ?? null,
        grossWeight: normalizeErpWeight(g.grossRaw, unit),
        finalTareWeight: normalizeErpWeight(g.tareRaw, unit),
        documentNetWeight: normalizeErpWeight(g.documentNetRaw, unit),
        scaleNetWeight: normalizeErpWeight(g.scaleNetRaw, unit),
        grnLines: grnRows.slice(0, 100).map((r) => ({
          grnDocId: r.grnDocId, grnNo: r.grnNo, grnDate: r.grnDate,
          rawApprovalStatus: r.rawApprovalStatus ?? null,
          approvedDate: r.approvedDate ?? null, verifiedDate: r.verifiedDate ?? null,
          lineNumber: r.lineNumber ?? null, itemCode: r.itemCode ?? null,
          materialName: r.materialName ?? null, materialDisplayName: r.materialDisplayName ?? r.materialName ?? null,
          unit: r.lineUnit ?? null, documentQty: r.documentQty == null ? null : String(r.documentQty),
          receiptQty: r.receiptQty == null ? null : String(r.receiptQty),
          acceptedQty: r.acceptedQty == null ? null : String(r.acceptedQty),
          poDocId: r.poDocId ?? null, poNo: r.poNo ?? null, poDate: r.poDate ?? null,
          rawPoApprovalStatus: r.rawPoApprovalStatus ?? null,
        })),
      },
      meta: {
        source: 'dataman.readonly.gate-facts', fetchedAt: new Date().toISOString(),
        grnLinesTruncated: linesTruncated,
        displayNameMeaning: 'DataMan supplier/item master display field; not a legal-name guarantee',
        approvalStatusMeaning: 'raw-uninterpreted; NOT proof of posted/paid/final state',
      },
    };
  }

  /** Accounting-only read; bill amounts and dates never exposed to Gate/QC. */
  @Get('live-bills-for-gate/:docId')
  @Requires('accounting.inbox')
  async bills(@Param('docId') rawDocId: string) {
    const docId = ErpWorkflowReadController.docId(rawDocId);
    const rows = await this.read<any>(`
      SELECT TOP(51) pb.DocId AS billDocId,pb.V_No AS billNo,
        pb.V_Date AS billDate,pb.PtyBillNo AS supplierInvoiceNo,
        pb.PtyBillDt AS supplierInvoiceDate,pb.NAmount AS netAmount,
        pb.CGSTAmt AS cgstAmount,pb.SGSTAmt AS sgstAmount,pb.IGSTAmt AS igstAmount,
        pb.ApprovalStatus AS rawApprovalStatus,pb.ApprovedDate AS approvedDate
      FROM dbo.PurBill pb
      WHERE pb.GIDocId=@docId
         OR EXISTS (
           SELECT 1 FROM dbo.PurBillDet bd
           JOIN dbo.PChallan pc ON pc.DocId=bd.PCHLDocId
           WHERE bd.DocId=pb.DocId AND pc.GIDocId=@docId
         )
      ORDER BY pb.V_Date DESC,pb.DocId DESC
    `, [{ name: 'docId', type: 'VarChar', value: docId }]);
    return {
      data: rows.slice(0, 50).map((r) => ({
        billDocId: r.billDocId,billNo: r.billNo,billDate: r.billDate,
        supplierInvoiceNo: r.supplierInvoiceNo ?? null,
        supplierInvoiceDate: r.supplierInvoiceDate ?? null,
        netAmount: r.netAmount == null ? null : String(r.netAmount),
        cgstAmount: r.cgstAmount == null ? null : String(r.cgstAmount),
        sgstAmount: r.sgstAmount == null ? null : String(r.sgstAmount),
        igstAmount: r.igstAmount == null ? null : String(r.igstAmount),
        rawApprovalStatus: r.rawApprovalStatus ?? null,
        approvedDate: r.approvedDate ?? null,
      })),
      meta: { source: 'dataman.readonly.bill-by-grn-line', fetchedAt: new Date().toISOString(),
        truncated: rows.length > 50, postingVerified: false },
    };
  }
}
