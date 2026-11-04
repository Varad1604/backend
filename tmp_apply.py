from pathlib import Path
from typing import List, Tuple

path = Path(r"C:\Users\Varad Deshpande\Downloads\KPMPL-Latest\backend\apps\api\src\modules\documents\documents.service.ts")
data = path.read_bytes()
text = data.decode("utf-8")

def replace_once(text: str, needle: str, replacement: str, label: str) -> str:
    if needle not in text:
        raise SystemExit(f"REPLACE FAILED: {label}")
    return text.replace(needle, replacement, 1)

edits: List[Tuple[str, str, str]] = [
    (
        "      const existing = await tx.accountingChecks.findUnique({ where: { packageId: id } });\r\n",
        "      const existing = await tx.accountingCheck.findUnique({ where: { packageId: id } });\r\n",
        "ACCCHECKS_FINDUNIQUE",
    ),
    (
        "      const checkMap: Record<string, { status: string; note: string | null }> = {};\r\n",
        "      const checkMap: Record<string, Prisma.InputJsonValue> = {};\r\n",
        "CHECKMAP_TYPE",
    ),
    (
        "        checkMap[c.type] = { status: c.status, note: c.note ?? null };\r\n",
        "        checkMap[c.type] = { status: c.status, note: c.note ?? null } as Prisma.InputJsonValue;\r\n",
        "CHECKMAP_ENTRY",
    ),
    (
        "      const jsonData: Record<string, Prisma.InputJsonValue> = {};\r\n",
        "      const jsonData: Record<string, Prisma.InputJsonValue> = {};\r\n",
        "JSONDATA_NOOP",
    ),
]

for needle, replacement, label in edits:
    text = replace_once(text, needle, replacement, label)

path.write_text(text, encoding="utf-8")
print("APPLIED")
