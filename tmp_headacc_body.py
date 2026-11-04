from pathlib import Path

path = Path(r"C:\Users\Varad Deshpande\Downloads\KPMPL-Latest\backend\apps\api\src\modules\documents\documents.service.ts")
data = path.read_bytes()
lines = data.splitlines(True)

before = sum(len(l) for l in lines[:409])
after = before + sum(len(l) for l in lines[409:417])

region = data[before:after]
print(f"410..417 region length {len(region)}")
print(repr(region))

target = (
    b"   */\r\n"
    b"  async headAccountantCases(actor: Actor)\r\n"
    b"  {\r\n"
    b"    await this.auth.authorize(actor, 'accounting.approve');\r\n"
    b"    return this.prisma.$transaction(async tx => {\r\n"
    b"      const rows = await tx.documentPackage.findMany({ where: { status: { in: ['with_head_accountant', 'accounting_approved'] } }, include, orderBy: { updatedAt: 'desc' } });\r\n"
    b"      const views = await Promise.all(rows.map(row => this.view(tx, row)));\r\n"
)

if region == target:
    print("MATCH")
else:
    print("MISMATCH")
    # show byte-wise diff of lengths
    print("target length", len(target))
    # show first 200 bytes of region as unicode-safe repr
    print("region snippet:", region[:260])
