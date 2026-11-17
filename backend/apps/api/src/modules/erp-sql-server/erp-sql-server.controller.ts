import { BadRequestException, Controller, Get, HttpException, HttpStatus, NotFoundException, Query, Param, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ErpSqlServerService } from './erp-sql-server.service';
import { Requires } from '../../modules/identity-access/access.decorators';
import { ErpQueryParam } from './erp-sql-server.service';

/**
 * Minimal ERP SQL Server read-only APIs — Phase 04B + Phase 05A acceptance corrections.
 *
 * ALL endpoints are READ-ONLY: no INSERT/UPDATE/DELETE.
 * Every business-data endpoint requires @Requires('erp.read') capability.
 * ERP connection failures return 503; do not cascade to KPMPL workflows.
 * Use ONLY verified DataMan SQL Server table columns (Phase 03 acceptance metadata).
 * Parameterized SQL with @name syntax + request.input() via explicit ErpQueryParam array —
 * no ? placeholders, no string interpolation, no fragile variadic argument handling.
 *
 * Weight units: verified as Decimal(12,3) in kg (Phase 02 §SCOPE / DECISIONS). The DTO
 * therefore labels weights 'kg'; it never invents a unit (Phase 05A defect: 'tons').
 *
 * Errors use the backend-standard envelope `{ error: { code, message, fields? } }`
 * (modules/common/http-error.filter.ts) so the frontend `toApiErrorFromResponse`
 * can read code and message. A bare `{ error: 'STRING' }` is NOT the contract.
 *
 * Critical: Certificate trust is unresolved (production DBA confirmation required).
 * These endpoints will return 503 ERP_UNAVAILABLE until valid cert trust is configured.
 */
@Controller('erp')
export class ErpSqlServerController {
  constructor(private readonly erpSqlServer: ErpSqlServerService) {}

  /** Clamp a raw query-string integer; defaults are applied here, not by a pipe. */
  private static intOr(raw: string | undefined, fallback: number): number {
    const n = Number(raw);
    return Number.isFinite(n) ? Math.trunc(n) : fallback;
  }

  /** Scalar ERP weight → DTO. Unit is verified kg; value is stringified, never recomputed. */
  private static weight(value: unknown): { value: string; unit: 'kg' } | null {
    if (value === null || value === undefined) return null;
    return { value: String(value), unit: 'kg' };
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
            grossWeight: null as { value: string; unit: 'kg' } | null,
            tareWeight: null as { value: string; unit: 'kg' } | null,
            netWeight: null as { value: string; unit: 'kg' } | null,
            hasWeighment: false,
            hasGrn: false,
            grnDate: null as unknown,
            grnApprovalStatus: null as unknown,
            fieldsAvailable: [] as string[],
          };
          byDocId.set(key, item);
        }

        // First weighment row wins for the summary; hasWeighment records presence.
        if (row.wDocId !== null && row.wDocId !== undefined) {
          item.hasWeighment = true;
          if (item.grossWeight === null) item.grossWeight = ErpSqlServerController.weight(row.grossWeight);
          if (item.tareWeight === null) item.tareWeight = ErpSqlServerController.weight(row.tareWeight);
          if (item.netWeight === null) item.netWeight = ErpSqlServerController.weight(row.netWeight);
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
          'grossWeight', 'tareWeight', 'netWeight'] as const).filter((f) => item[f] !== null && item[f] !== undefined),
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
        w.Weigh_Date AS weighDate,
        w.Weigh_DateOut AS weighDateOut,
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
            grossWeight: ErpSqlServerController.weight(row.grossWeight),
            tareWeight: ErpSqlServerController.weight(row.tareWeight),
            netWeight: ErpSqlServerController.weight(row.netWeight),
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
        // Summary of the first related records, plus the full arrays.
        grossWeight: firstWeighment?.grossWeight ?? null,
        tareWeight: firstWeighment?.tareWeight ?? null,
        netWeight: firstWeighment?.netWeight ?? null,
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
      if (dto.tareWeight) fieldsAvailable.push('tareWeight');
      if (dto.netWeight) fieldsAvailable.push('netWeight');
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
