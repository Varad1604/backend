from pathlib import Path
import re

path = Path(r"C:\Users\Varad Deshpande\Downloads\KPMPL-Latest\backend\apps\api\src\modules\documents\documents.service.ts")
data = path.read_bytes()
text = data.decode("utf-8")

# Replace the whole recordAccountingChecks method with a clean version that has no ambiguous trailing artifacts.
pattern = re.compile(
    r"  async recordAccountingChecks\(actor: Actor, id: string, input: \{ checks: \{ type: 'bill_passed' \| 'gst_checked' \| 'tds_checked'; status: 'pending' \| 'ok' \| 'issue'; note\?: string \}\[\] \}\) \{.*?"
    r"^\s*\}\);?\n",
    re.DOTALL | re.MULTILINE,
)

new_block = """  async recordAccountingChecks(actor: Actor, id: string, input: { checks: { type: 'bill_passed' | 'gst_checked' | 'tds_checked'; status: 'pending' | 'ok' | 'issue'; note?: string }[] }) {
    await this.auth.authorize(actor, 'accounting.review');
    return this.prisma.$transaction(async tx => {
      const before = await tx.documentPackage.findUnique({ where: { id }, include });
      if (!before) throw new NotFoundException();
      if (!ACCOUNTING_VISIBLE.includes(before.status as (typeof ACCOUNTING_VISIBLE)[number]))
        throw domain('This package is not in the accounting workflow.');
      if (before.status !== 'with_accounting')
        throw domain('The accountant can only record checks while the package is with them (with_accounting).');
      const checkerName = (await tx.user.findUnique({ where: { id: actor.userId }, select: { fullName: true } }))!.fullName;
      const now = new Date();
      const existing = await tx.accountingChecks.findUnique({ where: { packageId: id } });
      const checkMap: Record<string, { status: string; note: string | null }> = {};
      for (const c of input.checks) {
        checkMap[c.type] = { status: c.status, note: c.note ?? null };
        if (c.type === 'bill_passed') await tx.accountingChecks.update({ where: { packageId: id }, data: { billPassed: c.status === 'ok' } }).catch(() => {});
        if (c.type === 'gst_checked') await tx.accountingChecks.update({ where: { packageId: id }, data: { gstChecked: c.status === 'ok' } }).catch(() => {});
        if (c.type === 'tds_checked') await tx.accountingChecks.update({ where: { packageId: id }, data: { tdsChecked: c.status === 'ok' } }).catch(() => {});
      }
      const jsonData: Record<string, Prisma.InputJsonValue> = {};
      for (const [key, val] of Object.entries(checkMap)) {
        jsonData[key + 'Check'] = val;
      }
      if (existing) {
        await tx.accountingChecks.update({ where: { packageId: id }, data: { ...jsonData, checkedBy: actor.userId, checkedAt: now } });
      } else {
        await tx.accountingChecks.create({ data: { packageId: id, ...jsonData, checkedBy: actor.userId, checkedAt: now } });
      }
      const detailParts: string[] = [];
      for (const c of input.checks) {
        const label = c.type === 'bill_passed' ? 'Bill' : c.type === 'gst_checked' ? 'GST' : 'TDS';
        let part = `${label}: ${c.status}`;
        if (c.note) part += ` \\u2014 ${c.note}`;
        detailParts.push(part);
      }
      const detail = detailParts.join('; ');
      await tx.packageHistory.create({ data: { packageId: id, actorId: actor.userId, action: 'accounting_checks_recorded', detail: `Checks recorded.${detail ? ' ' + detail : ''}`, source: 'app' } });
      return { status: 200, body: json({ data: this.view(tx, before) }) };
    });
  }
""".lstrip("\n") + "\n"

m = pattern.search(text)
if not m:
    print("PATTERN NOT FOUND")
    raise SystemExit(1)

updated = text[:m.start()] + new_block + text[m.end():]
path.write_text(updated, encoding="utf-8")
print("PATCHED recordAccountingChecks")
