# Diagram Index (editable Mermaid sources)

**Validation status (honest disclosure):** no Mermaid renderer/CLI is available in this
environment and installing dependencies is out of scope. Every file was mechanically linted
by `../checks/validate_mermaid.py` (diagram-type declaration, fence/bracket/quote balance,
sequenceDiagram participant & arrow syntax, stateDiagram/erDiagram structural rules, note
placement, no Unicode implication operators) and hand-checked against the Mermaid grammar
with conservative syntax. **The diagrams are NOT machine-rendered** — render in any
Mermaid viewer (VS Code extension, mermaid.live) before sign-off; that render check is the
one remaining documentary condition (inherited from ZCode gate G15 / Ling's NOT-RENDERED
disclosure). Results: `../checks/validation_report.txt`.

| # | File | Type | Covers (mission checklist) | Anchored to |
|---|---|---|---|---|
| 1 | `system-context.mmd` | flowchart | System context (1) | `02` §1 |
| 2 | `deployment-topology.mmd` | flowchart | Deployment topology (2) | `02` §2, ADR-016/025 |
| 3 | `rust-modules.mmd` | flowchart | Rust module architecture (3) | `03` §1 |
| 4 | `dependency-boundaries.mmd` | flowchart | Dependency boundaries (4) | `03` §2, ADR-003 |
| 5 | `domain-interactions.mmd` | flowchart | Domain interactions (5) | `02` §3.1 |
| 6 | `gate-to-bill-e2e.mmd` | flowchart | End-to-end Gate-to-Bill workflow (6) | `06` §1 |
| 7 | `receiving-qc-sequence.mmd` | sequenceDiagram | Receiving and QC (7) | `06` §1, `03` §5 |
| 8 | `erp-verification.mmd` | sequenceDiagram | GRN and ERP evidence (8) | `07` §7 |
| 9 | `document-lifecycle.mmd` | sequenceDiagram | Document lifecycle (9) | `08` §2 |
| 10 | `ho-accounting.mmd` | sequenceDiagram | HO and accounting (10) | `06` §5, §8 |
| 11 | `auth-session-lifecycle.mmd` | sequenceDiagram | Authentication & session lifecycle (11) | `09` §2–4 |
| 12 | `database-erd.mmd` | erDiagram | Database ERD (12) | `04` §2–4 |
| 13 | `transaction-idempotency.mmd` | sequenceDiagram | Transaction & idempotency flows (13) | `03` §6/§8 |
| 14 | `external-effects.mmd` | flowchart | Outbox delivery & reconciliation (14; v1 jobs + proposed outbox) | `10` §6, ADR-014 |
| 15 | `security-trust-boundaries.mmd` | flowchart | Security trust boundaries (15) | `09` §1 |
| 16 | `failure-recovery.mmd` | flowchart | Failure and recovery (16) | `10` §1–4 |
| 17 | `migration-rollback.mmd` | flowchart | Migration and rollback (17) | `11` §3–6 |
| 18 | `verification-architecture.mmd` | flowchart | Future verification architecture (18) | `12` §1/§6 |
| 19 | `visit-qc-state.mmd` | stateDiagram-v2 | Retained: visit/weighment/QC state machines | `06` §2 |
| 20 | `package-state.mmd` | stateDiagram-v2 | Retained: package state machine (12 values) | `06` §7 |
| 21 | `file-accounting-milestone-state.mmd` | stateDiagram-v2 | Retained: file scan / accounting stage / milestone machines | `06` §8–10 |
| 22 | `audit-chain-anchor.mmd` | flowchart | Retained: audit chain + external anchoring | `04` §9, ADR-012 |

## Consistency rules maintained across every diagram

- One vocabulary (ADR-028): package.status (12) vs AccountingRecord.stage (4) vs
  scanStatus (4) vs ErpMilestone status/type — never mixed; `final_posting` appears only as
  a milestone type.
- One custody protocol (ADR-022): upload = scan → store publish (Phase-1 LocalFileStore, ADR-035) → one DB tx; no pending/scanning
  rows anywhere.
- One audit model (ADR-012): global chain head + external anchor.
- One route surface (`05`): 58 ops, auth under `/api/v1/auth/*`.
- One writer rule (`11`): single-writer cutover; per-domain split- writers shown only as rejected.
- Derived status domains never drawn as stored columns (`visit-qc-state` note).

## Render status (V1.3.3 — IV-11 CLOSED for this package)

All 22 diagrams were **machine-rendered on 2026-11-21 with mermaid v11.12.2** (in-browser; parse + layout + SVG output succeeded, 0 failures). Evidence: `checks/render_results_v1_3_3.json`. Ten diagrams previously failed real-render parsing (mid-text `;`, invalid `Note:` in the ERD, single-line state notes, an inner `:` in a transition label) — all fixed in V1.3.3; the structural validator alone had not caught them. Re-render `ALL_DIAGRAMS_RENDERABLE.md` in any renderer to re-verify.
