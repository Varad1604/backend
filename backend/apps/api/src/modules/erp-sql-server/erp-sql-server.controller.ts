import { BadRequestException, Controller, Get, HttpException, HttpStatus, NotFoundException, Query, Param, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ErpSqlServerService } from './erp-sql-server.service';
import { Requires } from '../../modules/identity-access/access.decorators';
import { ErpQueryParam } from './erp-sql-server.service';
import { normalizeErpWeight, type ErpWeight } from './erp-weights';

/**
 * Minimal ERP SQL Server read-only APIs — Phase 04B + Phase 05A acceptance corrections.
 *
 * ALL endpoints are READ-ONLY: no INSERT/UPDATE/DELETE.
 * Every business-data endpoint requires @Requires('erp.read') capability.
 * ERP connection failures return 503; do not cascade to KPMPL workflows.
 * Use ONLY verified DataMan SQL Server table columns (Phase 03 acceptance metadata,
 * extended 2026-11-17 with the live-verified outgoing columns Out_Tare_Weight /
 * Out_Net_Weight and the PChallanDetail unit-evidence column).
 * Parameterized SQL with @name syntax + request.input() via explicit ErpQueryParam array —
 * no ? placeholders, no string interpolation, no fragile variadic argument handling.
 *
 * Weight units (live-verified 2026-11-17, read-only queries): gate entries WITH GRN
 * evidence record weights in METRIC TONNES — PChallanDetail.Unit = 'MT', with
 * DocQty = Weightment.Net_Weight and RecptQty/AcpQty = Weightment.Out_Net_Weight.
 * Those scalars are normalized to kg exactly once, here at the adapter boundary
 * (decimal-point shift ×1000 — see erp-weights.ts; never float multiplication, never
 * recomputed). Gate entries WITHOUT GRN evidence have no verifiable unit: their raw
 * values pass through with unit null and provenance 'unverified' — never relabeled,
 * never converted, never guessed.
 *
 * Two different nets are preserved as recorded (they differ on real records and the
 * reason is DataMan's business, not KPMPL's):
 *   - netWeight       = Weightment.Net_Weight      (document net)
 *   - scaleNetWeight  = Weightment.Out_Net_Weight  (weighbridge net)
 * and the final outgoing tare comes from Weightment.Out_Tare_Weight — never the
 * weigh-in Tare_Weight. NULL stays null (not recorded); zero is genuine zero.
 *
 * Errors use the backend-standard envelope `{ error: { code, message, fields? } }`
 * (modules/common/http-error.filter.ts) so the frontend `toApiErrorFromResponse`
 * can read code and message. A bare `{ error: 'STRING' }` is NOT the contract.
 *
 * Critical: Certificate trust is unresolved (production DBA confirmation required).
 * These endpoints will return 503 ERP_UNAVAILABLE until valid cert trust is configured.
 */

/**
 * Unit evidence for one gate entry, read from its GRN's PChallanDetail rows.
 * The unit counts as verified ONLY when every non-null Unit on the gate's GRN
 * details agrees (COUNT(DISTINCT) = 1); mixed or absent evidence yields NULL, which
 * the adapter treats as "unverified" — it never guesses a unit.
 * Scalar subquery: one value per gate entry, no extra join fan-out.
 */
const GRN_UNIT_SUBQUERY = (gateRef: 'gp' | 'g'): string => `
        (SELECT CASE WHEN COUNT(DISTINCT pd.Unit) = 1 THEN MIN(pd.Unit) ELSE NULL END
           FROM PChallanDetail pd
          INNER JOIN PChallan pc ON pc.DocId = pd.DocId
          WHERE pc.GIDocId = ${gateRef}.DocId AND pd.Unit IS NOT NULL) AS grnUnit`
@Controller('erp')
export class ErpSqlServerController {
  constructor(private readonly erpSqlServer: ErpSqlServerService) {}

  /** Clamp a raw query-string integer; defaults are applied here, not by a pipe. */
  private static intOr(raw: string | undefined, fallback: number): number {
    const n = Number(raw);
    return Number.isFinite(n) ? Math.trunc(n) : fallback;
  }

  /**
   * The gate's verified GRN unit evidence for this joined row (repeats per row of the
   * same gate entry), or null when there is none. Raw column name: grnUnit.
   */
  private static grnUnitOf(row: { grnUnit?: unknown }): string | null {
    return typeof row.grnUnit === 'string' && row.grnUnit.length > 0 ? row.grnUnit : null;
  }

  /** Only real connectivity failures enable reason-controlled manual entry. */
  private static isTemporaryErpOutage(error: unknown): boolean {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code ?? '').toUpperCase() : '';
    if (['ELOGIN', 'EREQUEST', 'EINVALID', 'EPARAM'].includes(code)) return false;
    if (['ETIMEOUT', 'ESOCKET', 'ECONNCLOSED', 'ENOTOPEN', 'ECONNRESET', 'ENETUNREACH', 'EHOSTUNREACH'].includes(code)) return true;
    const message = error instanceof Error ? error.message : String(error);
    if (/invalid\s+column|invalid\s+object|permission\s+denied|login\s+failed|unsupported\s+sql\s+type/i.test(message)) return false;
    return /connection pool not initialized|connection.*unavailable|network.*unavailable|connection.*(?:closed|failed|timed out)|request.*timed out|ETIMEDOUT|ECONNREFUSED/i.test(message);
  }

  /**
   * Role-scoped, read-only DataMan gate lookup for KPMPL workflows.
   * This deliberately exposes only the fields all receiving.view roles need, rather
   * than granting every operator unrestricted access to the full ERP browser.
   * V_No repeats across years: require a year and return candidates with full DocId.
   * Never guess supplier name, material, PO or weight unit.
   */
  @Get('gate-lookup')
  @Requires('receiving.view')
  async lookupGate(
    @Res({ passthrough: true }) reply: FastifyReply,
    @Req() request: FastifyRequest & { id?: string },
    @Query('gateNo') rawGateNo?: string,
    @Query('year') rawYear?: string,
  ) {
    const gateNo = rawGateNo?.trim() ?? '';
    const year = Number(rawYear);
    if (!gateNo || gateNo.length > 64 || /[\u0000-\u001f]/.test(gateNo)) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Valid DataMan gate number required.' });
    }
    if (!rawYear || !/^\d{4}$/.test(rawYear) || !Number.isInteger(year) || year < 2000 || year > 2100) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'A four-digit gate entry year is required.' });
    }
    const sql = `
      SELECT TOP (21)
        g.DocId, g.V_No, g.V_Date, g.V_Time, g.VehicleNo, g.PartyCode,
        w.Actual_GWeight AS grossWeight,
        ${GRN_UNIT_SUBQUERY('g')}
      FROM GateInOut g
      OUTER APPLY (
        SELECT TOP (1) w1.Actual_GWeight
        FROM Weightment w1
        WHERE w1.GIDocId = g.DocId
        ORDER BY w1.Weigh_Date ASC, w1.DocId ASC
      ) w
      WHERE g.V_No = @gateNo
        AND g.V_Date >= @fromDate AND g.V_Date < @toDate
      ORDER BY g.V_Date DESC, g.DocId DESC
    `;
    const params: ErpQueryParam[] = [
      { name: 'gateNo', type: 'VarChar', value: gateNo },
      { name: 'fromDate', type: 'VarChar', value: `${year}-01-01` },
      { name: 'toDate', type: 'VarChar', value: `${year + 1}-01-01` },
    ];
    try {
      const result: any[] = await this.erpSqlServer.executeQuery(sql, params);
      return {
        data: (result ?? []).slice(0, 20).map((row) => ({
          docId: String(row.DocId), gateNo: String(row.V_No),
          gateDate: row.V_Date ?? null, gateTime: row.V_Time ?? null,
          vehicleNo: row.VehicleNo ?? null,
          partyCode: row.PartyCode ?? null, // a CODE, never fabricated as a display name
          grossWeight: normalizeErpWeight(row.grossWeight, ErpSqlServerController.grnUnitOf(row)),
        })),
        meta: {
          source: 'erp.sql.server.gate-lookup',
          fetchedAt: new Date().toISOString(),
          gateNo, year, truncated: (result ?? []).length > 20,
        },
      };
    } catch (error) {
      this.erpSqlServer['logger'].error(`ErpSqlServerController.lookupGate: ${error instanceof Error ? error.message : String(error)}`);
      const unavailable = ErpSqlServerController.isTemporaryErpOutage(error);
      void reply.code(unavailable ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.INTERNAL_SERVER_ERROR);
      return {
        error: {
          code: unavailable ? 'ERP_UNAVAILABLE' : 'ERP_QUERY_FAILED',
          message: unavailable
            ? 'ERP data source temporarily unavailable.'
            : 'ERP lookup could not be completed. Contact the administrator; do not enter an unverified manual record.',
          meta: { retryable: unavailable, source: 'erp.sql.server.gate-lookup' },
          requestId: request?.id,
        },
      };
    }
  }

  /**
   * @Requires('erp.read')
   * Paginated listing of ERP gate entries.
   *
   * Query parameters:
   * - page: page number (default 1, min 1)
   * - limit: items per page (default 20, max 100)
   * - docId: filter by GateInOut.DocId (optional string)
   * - vType: filter by PChallan.V_Type (optional string; 'PCHLG' is the sampled GRN type.
   *   The full V_Type value set is unverified, so this is an exact-match filter only —
   *   it is NOT a validated enumeration and must not be presented as one).
   *
   * Pagination is per gate entry: ROW_NUMBER() is computed over GateInOut only, so a
   * gate entry with several Weightment/PChallan rows cannot duplicate or shift pages.
   * Total count comes from GateInOut alone (no join fan-out).
   *
   * ERP unavailable → 503; missing record → 404; valid empty list → 200.
   */
  @Get('gate-entries')
  @Requires('erp.read')
  async listGateEntries(
    // Fastify adapter: passthrough keeps Nest's own serialization, so the body must be
    // RETURNED (never `res.json`, which does not exist on FastifyReply — Phase 06 defect).
    @Res({ passthrough: true }) reply: FastifyReply,
    @Req() request: FastifyRequest & { id?: string },
    @Query('page') rawPage?: string,
    @Query('limit') rawLimit?: string,
    @Query('docId') docId?: string,
    @Query('vType') vType?: string,
  ) {
    // Conservative pagination bounds
    const pageNum = Math.max(1, ErpSqlServerController.intOr(rawPage, 1));
    const limitNum = Math.min(Math.max(1, ErpSqlServerController.intOr(rawLimit, 20)), 100);
    const skip = (pageNum - 1) * limitNum;

    // Gate-level WHERE conditions and their bound parameters.
    // Verified columns only: GateInOut.DocId, GateInOut.V_Type/V_No/V_Date/V_Time/
    // PartyCode/VehicleNo/GateOutDate; Weightment.GIDocId/Actual_GWeight/Tare_Weight/
    // Net_Weight; PChallan.GIDocId/V_Type/GRN_Date/ApprovalStatus.
    const gateConditions: string[] = [];
    const filterParams: ErpQueryParam[] = [];

    if (docId) {
      gateConditions.push('g.DocId = @docId');
      filterParams.push({ name: 'docId', type: 'VarChar', value: docId });
    }
    if (vType) {
      // EXISTS keeps gate entries without a PChallan row out of a vType-filtered list
      // without duplicating them when several PChallan rows match.
      gateConditions.push('EXISTS (SELECT 1 FROM PChallan ch WHERE ch.GIDocId = g.DocId AND ch.V_Type = @vType)');
      filterParams.push({ name: 'vType', type: 'VarChar', value: vType });
    }

    const gateWhere = gateConditions.length > 0 ? `WHERE ${gateConditions.join(' AND ')}` : '';

    // Count: GateInOut alone — no join fan-out, so the total is the number of gate entries.
    const countQuery = `
      SELECT COUNT(*) AS total
      FROM GateInOut g
      ${gateWhere}
    `;

    // Data: paginate gate entries first (ROW_NUMBER over GateInOut), then join the
    // optional Weightment/PChallan rows for the current page only.
    const dataQuery = `
      WITH GatePage AS (
        SELECT
          g.DocId,
          g.V_Type,
          g.V_No,
          g.V_Date,
          g.V_Time,
          g.PartyCode,
          g.VehicleNo,
          g.GateOutDate,
          ROW_NUMBER() OVER (ORDER BY g.V_Date DESC, g.DocId) AS rn
        FROM GateInOut g
        ${gateWhere}
      )
      SELECT
        gp.DocId,
        gp.V_Type,
        gp.V_No,
        gp.V_Date,
        gp.V_Time,
        gp.PartyCode,
        gp.VehicleNo,
        gp.GateOutDate,
        w.DocId AS wDocId,
        w.Actual_GWeight AS grossWeight,
        w.Tare_Weight AS tareWeight,
        w.Net_Weight AS netWeight,
        w.Out_Tare_Weight AS outTareWeight,
        w.Out_Net_Weight AS outNetWeight,${GRN_UNIT_SUBQUERY('gp')},
        p.DocId AS pDocId,
        p.V_Type AS pVType,
        p.GRN_Date AS grnDate,
        p.ApprovalStatus AS grnApprovalStatus
      FROM GatePage gp
      LEFT JOIN Weightment w ON w.GIDocId = gp.DocId
      LEFT JOIN PChallan p ON p.GIDocId = gp.DocId
      WHERE gp.rn > @skip AND gp.rn <= @skip + @limit
      ORDER BY gp.rn
    `;

    const dataParams: ErpQueryParam[] = [
      ...filterParams,
      { name: 'skip', type: 'Int', value: skip },
      { name: 'limit', type: 'Int', value: limitNum },
    ];

    try {
      const countResult = await this.erpSqlServer.executeScalar(countQuery, filterParams);
      const total = Number(countResult) || 0;

      const rows: any[] = await this.erpSqlServer.executeQuery(dataQuery, dataParams);

      // Collapse the join fan-out back to one item per gate entry.
      const byDocId = new Map<string, any>();
      for (const row of rows || []) {
        const key = String(row.DocId);
        let item = byDocId.get(key);
        const grnUnit = ErpSqlServerController.grnUnitOf(row);
        if (!item) {
          item = {
            docId: row.DocId,
            vType: row.V_Type ?? null,
            vNo: row.V_No ?? null,
            vDate: row.V_Date ?? null,
            vTime: row.V_Time ?? null,
            partyCode: row.PartyCode ?? null,
            vehicleNo: row.VehicleNo ?? null,
            gateOutDate: row.GateOutDate ?? null,
            grossWeight: null as ErpWeight | null,
            finalTareWeight: null as ErpWeight | null,
            netWeight: null as ErpWeight | null,
            scaleNetWeight: null as ErpWeight | null,
            hasWeighment: false,
            hasGrn: false,
            grnDate: null as unknown,
            grnApprovalStatus: null as unknown,
            fieldsAvailable: [] as string[],
          };
          byDocId.set(key, item);
        }

        if (row.wDocId !== null && row.wDocId !== undefined) {
          item.hasWeighment = true;
          // Gross and DOCUMENT net: the FIRST weighment row wins (existing contract).
          if (item.grossWeight === null) item.grossWeight = normalizeErpWeight(row.grossWeight, grnUnit);
          if (item.netWeight === null) item.netWeight = normalizeErpWeight(row.netWeight, grnUnit);
          // FINAL outgoing tare and WEIGHBRIDGE net: the last row that actually recorded
          // an outgoing value wins (rows arrive ordered by Weigh_Date). A weighment
          // without outgoing values contributes nothing here — an incomplete record is
          // never presented as a completed zero.
          if (row.outTareWeight !== null && row.outTareWeight !== undefined) {
            item.finalTareWeight = normalizeErpWeight(row.outTareWeight, grnUnit);
          }
          if (row.outNetWeight !== null && row.outNetWeight !== undefined) {
            item.scaleNetWeight = normalizeErpWeight(row.outNetWeight, grnUnit);
          }
        }
        if (row.pDocId !== null && row.pDocId !== undefined) {
          item.hasGrn = true;
          if (item.grnDate === null) item.grnDate = row.grnDate ?? null;
          if (item.grnApprovalStatus === null) item.grnApprovalStatus = row.grnApprovalStatus ?? null;
        }
      }

      const items = [...byDocId.values()].map((item) => ({
        ...item,
        fieldsAvailable: (['docId', 'vType', 'vNo', 'vDate', 'vTime', 'partyCode', 'vehicleNo', 'gateOutDate',
          'grossWeight', 'finalTareWeight', 'netWeight', 'scaleNetWeight'] as const).filter((f) => item[f] !== null && item[f] !== undefined),
      }));

      const totalPages = total > 0 ? Math.ceil(total / limitNum) : 0;

      // A legitimately empty page is a 200, never a stand-in for an outage.
      return {
        data: items,
        meta: {
          source: 'erp.sql.server.gate-entries.list',
          total,
          page: pageNum,
          limit: limitNum,
          totalPages,
          retrievedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      this.erpSqlServer['logger'].error(
        `ErpSqlServerController.listGateEntries: error: ${error instanceof Error ? error.message : String(error)}`,
      );
      // ERP connection/TLS/timeout/SQL failure → 503. Never a 200 with empty data.
      // The envelope is built here (not by the global filter) so the specific
      // ERP_UNAVAILABLE code survives on a 5xx response.
      void reply.code(HttpStatus.SERVICE_UNAVAILABLE);
      return {
        error: {
          code: 'ERP_UNAVAILABLE',
          message: 'ERP data source temporarily unavailable.',
          meta: { retryable: true, source: 'erp.sql.server.gate-entries.list' },
          requestId: request?.id,
        },
      };
    }
  }

  /**
   * @Requires('erp.read')
   * Detail endpoint for a specific gate entry by DocId.
   *
   * Returns the gate entry plus every related Weightment and PChallan/GRN row. A gate
   * entry may have no weighment and/or no GRN; those are reported as empty arrays and
   * false `hasWeighment` / `hasGrn` flags, never as an error.
   * Missing DocId → 404 Not Found (distinguishes from ERP unavailable).
   * ERP connection failure → 503 ERP_UNAVAILABLE.
   */
  @Get('gate-entries/:docId')
  @Requires('erp.read')
  async readGateEntry(
    @Res({ passthrough: true }) reply: FastifyReply,
    @Req() request: FastifyRequest & { id?: string },
    @Param('docId') docId: string,
  ) {
    if (!docId || docId.trim().length === 0) {
      // Thrown, so the global filter adds requestId and keeps the standard envelope.
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'docId parameter is required and must be non-empty',
        fields: { docId: 'Must provide a valid GateInOut.DocId' },
      });
    }

    const query = `
      SELECT
        g.DocId,
        g.V_Type,
        g.V_No,
        g.V_Date,
        g.V_Time,
        g.PartyCode,
        g.VehicleNo,
        g.GateOutDate,
        w.DocId AS wDocId,
        w.Weigh_SlipNo AS weighSlipNo,
        w.Actual_GWeight AS grossWeight,
        w.Tare_Weight AS tareWeight,
        w.Net_Weight AS netWeight,
        w.Out_Tare_Weight AS outTareWeight,
        w.Out_Net_Weight AS outNetWeight,
        w.Weigh_Date AS weighDate,
        w.Weigh_DateOut AS weighDateOut,${GRN_UNIT_SUBQUERY('g')},
        p.DocId AS pDocId,
        p.V_Type AS pVType,
        p.V_No AS pVNo,
        p.GRN_Date AS grnDate,
        p.ApprovalStatus AS grnApprovalStatus
      FROM GateInOut g
      LEFT JOIN Weightment w ON w.GIDocId = g.DocId
      LEFT JOIN PChallan p ON p.GIDocId = g.DocId
      WHERE g.DocId = @docId
      ORDER BY g.DocId, w.Weigh_Date, p.GRN_Date
    `;

    try {
      // Full recordset: several weighment/GRN rows per gate entry must not be truncated.
      const rows: any[] = await this.erpSqlServer.executeQuery(query, [
        { name: 'docId', type: 'VarChar', value: docId },
      ]);

      if (!rows || rows.length === 0) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: `Gate entry with DocId "${docId}" not found in ERP.`,
          meta: { source: 'erp.sql.server.gate-entry.read' },
        });
      }

      const head = rows[0];
      const grnUnit = ErpSqlServerController.grnUnitOf(head);

      // De-duplicate joined rows by their own primary DocId.
      const weighments: any[] = [];
      const seenW = new Set<string>();
      const grns: any[] = [];
      const seenP = new Set<string>();

      for (const row of rows) {
        if (row.wDocId !== null && row.wDocId !== undefined && !seenW.has(String(row.wDocId))) {
          seenW.add(String(row.wDocId));
          weighments.push({
            weighmentDocId: row.wDocId,
            weighSlipNo: row.weighSlipNo ?? null,
            // Raw recorded values, each normalized with the gate's unit evidence:
            grossWeight: normalizeErpWeight(row.grossWeight, grnUnit),      // Actual_GWeight
            tareWeight: normalizeErpWeight(row.tareWeight, grnUnit),        // weigh-in Tare_Weight
            netWeight: normalizeErpWeight(row.netWeight, grnUnit),          // document net (Net_Weight)
            outTareWeight: normalizeErpWeight(row.outTareWeight, grnUnit),  // final outgoing tare
            outNetWeight: normalizeErpWeight(row.outNetWeight, grnUnit),    // weighbridge net
            weighDate: row.weighDate ?? null,
            weighDateOut: row.weighDateOut ?? null,
          });
        }
        if (row.pDocId !== null && row.pDocId !== undefined && !seenP.has(String(row.pDocId))) {
          seenP.add(String(row.pDocId));
          grns.push({
            challanDocId: row.pDocId,
            vType: row.pVType ?? null,
            vNo: row.pVNo ?? null,
            grnDate: row.grnDate ?? null,
            approvalStatus: row.grnApprovalStatus ?? null,
          });
        }
      }

      const firstWeighment = weighments[0];
      const firstGrn = grns[0];

      const dto = {
        docId: head.DocId,
        vType: head.V_Type ?? null,
        vNo: head.V_No ?? null,
        vDate: head.V_Date ?? null,
        vTime: head.V_Time ?? null,
        partyCode: head.PartyCode ?? null,
        vehicleNo: head.VehicleNo ?? null,
        gateOutDate: head.GateOutDate ?? null,
        // Summary of the first related records, plus the full arrays. Gross and
        // DOCUMENT net come from the first weighment row; the FINAL outgoing tare and
        // WEIGHBRIDGE net come from the last weighment row that recorded them.
        grossWeight: firstWeighment?.grossWeight ?? null,
        netWeight: firstWeighment?.netWeight ?? null,
        finalTareWeight: weighments.reduce<ErpWeight | null>((acc, w) => w.outTareWeight ?? acc, null),
        scaleNetWeight: weighments.reduce<ErpWeight | null>((acc, w) => w.outNetWeight ?? acc, null),
        grnDate: firstGrn?.grnDate ?? null,
        grnApprovalStatus: firstGrn?.approvalStatus ?? null,
        hasWeighment: weighments.length > 0,
        hasGrn: grns.length > 0,
        weighments,
        grns,
      };

      const verifiedFields = ['docId', 'vType', 'vNo', 'vDate', 'vTime', 'partyCode', 'vehicleNo', 'gateOutDate'];
      const fieldsAvailable = verifiedFields.filter(
        (f) => (dto as Record<string, unknown>)[f] !== null && (dto as Record<string, unknown>)[f] !== undefined,
      );
      if (dto.grossWeight) fieldsAvailable.push('grossWeight');
      if (dto.finalTareWeight) fieldsAvailable.push('finalTareWeight');
      if (dto.netWeight) fieldsAvailable.push('netWeight');
      if (dto.scaleNetWeight) fieldsAvailable.push('scaleNetWeight');
      if (dto.grnDate) fieldsAvailable.push('grnDate');

      return {
        data: dto,
        meta: {
          source: 'erp.sql.server.gate-entry.read',
          retrievedAt: new Date().toISOString(),
          fieldsAvailable,
          fieldsMissing: verifiedFields.filter((f) => !fieldsAvailable.includes(f)),
        },
      };
    } catch (error) {
      // A missing record is a real answer, not an outage — let the filter answer 404.
      if (error instanceof HttpException) throw error;
      this.erpSqlServer['logger'].error(
        `ErpSqlServerController.readGateEntry: docId=${docId}, error: ${error instanceof Error ? error.message : String(error)}`,
      );
      void reply.code(HttpStatus.SERVICE_UNAVAILABLE);
      return {
        error: {
          code: 'ERP_UNAVAILABLE',
          message: 'ERP data source temporarily unavailable.',
          meta: { retryable: true, source: 'erp.sql.server.gate-entry.read' },
          requestId: request?.id,
        },
      };
    }
  }
}
