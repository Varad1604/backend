import { HttpException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CreateVisitInput } from '../receiving/receiving.schemas';
import { ErpSqlServerService } from './erp-sql-server.service';
import { normalizeErpWeight } from './erp-weights';

/** Fail closed for query bugs, permissions, configuration and invalid ERP identity. */
export function isRealConnectionFailure(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code ?? '').toUpperCase() : '';
  if (['ELOGIN', 'EREQUEST', 'EPARAM', 'EINVALID'].includes(code)) return false;
  if (['ETIMEOUT', 'ESOCKET', 'ECONNCLOSED', 'ENOTOPEN', 'ECONNRESET', 'ENETUNREACH', 'EHOSTUNREACH'].includes(code)) return true;
  const message = error instanceof Error ? error.message : String(error);
  if (/pool not initialized|missing required ERP environment|login failed|certificate|invalid column|invalid object|permission denied/i.test(message)) return false;
  return /connection.*(?:refused|closed|timed out|failed)|network.*(?:unavailable|unreachable)|ETIMEDOUT|ECONNREFUSED|request.*timed out/i.test(message);
}

export type VerifiedGateEvidence = {
  gateNo: string; year: number; docId: string | null; fetchedAt: string | null;
  manualReason: string | null; verification: 'server_verified' | 'manual_exception';
};

function invalid(message: string): never {
  throw new HttpException({ code: 'VALIDATION_FAILED', message: 'DataMan verification failed.', fields: { erpEvidence: message } }, 422);
}
function serviceError(): never {
  throw new HttpException({ code: 'ERP_QUERY_FAILED', message: 'DataMan verification could not complete. Contact your administrator; no record was saved.' }, 500);
}

@Injectable()
export class ErpGateEvidenceVerifier {
  constructor(private readonly erp: ErpSqlServerService) {}

  /** A gate-level read; all DataMan calls are SELECT-only and parameterized. */
  async verify(input: CreateVisitInput): Promise<VerifiedGateEvidence | null> {
    const evidence = input.erpEvidence;
    if (!evidence) return null; // transitional compatibility with existing clients
    const base = {
      gateNo: evidence.gateNo, year: evidence.year,
      docId: evidence.docId ?? null, fetchedAt: evidence.fetchedAt ?? null,
      manualReason: evidence.manualReason ?? null,
    };
    if (!evidence.docId) {
      // Manual exception only when a real, configured ERP source fails.
      if (!process.env.ERP_PASSWORD || !process.env.ERP_HOST) serviceError();
      try {
        await this.erp.executeScalar('SELECT 1', []);
      } catch (err) {
        if (!isRealConnectionFailure(err)) serviceError();
        return { ...base, verification: 'manual_exception' };
      }
      invalid('DataMan is available. Select the correct ERP entry instead of a manual exception.');
    }
    if (!process.env.ERP_PASSWORD || !process.env.ERP_HOST) serviceError();
    const query = `
      SELECT TOP (2) g.DocId, g.V_No, g.V_Date, g.VehicleNo,
        sg.DisplayName AS supplierDisplayName, sg.Name AS supplierName,
        im.DispName AS materialDisplayName, im.Name AS materialName,
        wi.DispName AS weighmentMaterialDisplayName, wi.Name AS weighmentMaterialName,
        po.V_No AS poNo, wpo.V_No AS weighmentPoNo,
        w.Actual_GWeight AS grossWeight,
        (SELECT CASE WHEN COUNT(DISTINCT pd.Unit) = 1 THEN MIN(pd.Unit) ELSE NULL END
           FROM PChallanDetail pd INNER JOIN PChallan pc ON pc.DocId = pd.DocId
          WHERE pc.GIDocId = g.DocId AND pd.Unit IS NOT NULL) AS grnUnit
      FROM GateInOut g
      LEFT JOIN SubGroup sg ON sg.SubCode=g.PartyCode
      OUTER APPLY (
        SELECT TOP (1) w1.Actual_GWeight,w1.ItemCode,w1.OrdDocID
          FROM Weightment w1 WHERE w1.GIDocId = g.DocId
          ORDER BY w1.Weigh_Date ASC, w1.DocId ASC
      ) w
      LEFT JOIN ItemMast wi ON wi.Code=w.ItemCode
      LEFT JOIN POrd wpo ON wpo.DocId=w.OrdDocID
      OUTER APPLY (
        SELECT TOP(1) pd.ItemCode,pd.OrdDocID
        FROM PChallan pc INNER JOIN PChallanDetail pd ON pd.DocId=pc.DocId
        WHERE pc.GIDocId=g.DocId
        ORDER BY pc.GRN_Date DESC,pc.DocId DESC,pd.V_SNo ASC
      ) grn
      LEFT JOIN ItemMast im ON im.Code=grn.ItemCode
      LEFT JOIN POrd po ON po.DocId=grn.OrdDocID
      WHERE g.DocId = @docId AND g.V_No = @gateNo
        AND g.V_Date >= @fromDate AND g.V_Date < @toDate
    `;
    let rows: Array<{ DocId: unknown; V_No: unknown; VehicleNo?: unknown; grossWeight?: unknown; grnUnit?: unknown;
      supplierDisplayName?: unknown; supplierName?: unknown; materialDisplayName?: unknown; materialName?: unknown;
      weighmentMaterialDisplayName?: unknown; weighmentMaterialName?: unknown;
      poNo?: unknown; weighmentPoNo?: unknown }>;
    try {
      rows = await this.erp.executeQuery(query, [
        { name: 'docId', type: 'VarChar', value: evidence.docId },
        { name: 'gateNo', type: 'VarChar', value: evidence.gateNo },
        { name: 'fromDate', type: 'VarChar', value: `${evidence.year}-01-01` },
        { name: 'toDate', type: 'VarChar', value: `${evidence.year + 1}-01-01` },
      ]);
    } catch (err) {
      if (isRealConnectionFailure(err)) {
        throw new HttpException({ code: 'ERP_UNAVAILABLE', message: 'Cannot verify the selected DataMan record. Retry or use the controlled outage procedure.' }, 503);
      }
      serviceError();
    }
    if (rows.length !== 1) invalid('The selected full DataMan document ID was not found uniquely for this gate number and year.');
    const row = rows[0]!;
    const vehicle = String(row.VehicleNo ?? '').trim().toUpperCase();
    if (vehicle) {
      if (vehicle !== input.vehicleNumber.trim().toUpperCase()) invalid('The vehicle number changed in DataMan. Refresh and reselect the ERP record.');
    } else if (!evidence.manualReason) invalid('DataMan has no vehicle number. Explain the manual exception.');
    const unit = typeof row.grnUnit === 'string' ? row.grnUnit : null;
    const weight = normalizeErpWeight(row.grossWeight, unit);
    if (weight?.unit === 'kg' && weight.provenance === 'grn') {
      if (!new Prisma.Decimal(weight.value).equals(new Prisma.Decimal(input.grossWeight.value))) {
        invalid('The verified gross weight changed in DataMan. Refresh and reselect the ERP record.');
      }
    } else if (!evidence.manualReason) invalid('The DataMan gross weight or its unit cannot be verified. Explain the manual exception.');
    // ERP-owned text is independently checked at write time when the source exists.
    // Preserve manual exceptions when a source is missing; never silently validate a spoofed name.
    const normalized = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
    const supplier = normalized(row.supplierDisplayName || row.supplierName);
    const material = normalized(row.materialDisplayName || row.materialName ||
      row.weighmentMaterialDisplayName || row.weighmentMaterialName);
    const poNo = normalized(row.poNo || row.weighmentPoNo);
    if (supplier && normalized(input.supplierDisplayName) !== supplier && !evidence.manualReason) {
      invalid('The DataMan supplier changed. Refresh and reselect the ERP record.');
    }
    if (material && normalized(input.materialDisplayName) !== material && !evidence.manualReason) {
      invalid('The DataMan material changed. Refresh and reselect the ERP record.');
    }
    if (poNo && input.poRef && normalized(input.poRef) !== poNo && !evidence.manualReason) {
      invalid('The DataMan purchase order changed. Refresh and reselect the ERP record.');
    }
    return { ...base, verification: 'server_verified' };
  }
}
