# Quick operator walkthrough

Open http://localhost:5173. Use synthetic demo accounts. Gate and QC need separate
browser profiles/private windows because normal tabs share login cookies.

1. Gate: New arrival → Gate Entry no., Truck no., Gross weight → Save arrival.
   More details (optional) retains supplier, material, challan, PO, notes and unit.
2. Gate: enter Tare weight → Save tare. This does not mark the truck departed.
   Truck has left remains locked until QC explicitly records demo clear.
3. QC: open the truck. Choose Demo clear or enter a short reason and choose Demo hold.
   Notes/readings are optional for demo clear. Save note only never clears a truck.
4. Gate: Refresh records to see QC's demo state. Hold/pending keeps departure locked.
   Demo clear + tare makes Truck has left available; use it after the truck leaves.
5. Optional GRN: More actions → Add GRN reference → GRN no. →
   Verified in DataMan — save. Arrival details and History remain accessible.

QC edits without a fresh decision invalidate previous clearance. Held and pending
trucks remain in the QC queue. Only QC operators may clear/hold (D-03, decided
2026-11-03: the QC operator makes the final QC decision). No ERP approval or formula is inferred.

Verified locally: 43 backend + 8 web tests and 4 browser journeys, including Hold,
notes without clearance, direct API denial and concurrent Hold/departure. Human
workflow feedback, migration review and merge approval remain pending.
