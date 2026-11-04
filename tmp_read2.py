from pathlib import Path

p = Path(r"C:\Users\Varad Deshpande\Downloads\KPMPL-Latest\backend\apps\api\src\modules\documents\documents.service.ts")
data = p.read_bytes()

# Line numbers reported by tsc are 1-based. Print raw lines 405..420 with byte offsets.
lines = data.splitlines(True)
offset = 0
for idx, line in enumerate(lines):
    lineno = idx + 1
    if 405 <= lineno <= 420:
        print(f"--- line {lineno} @ byte {offset} (len {len(line)}) ---")
        print(repr(line))
    offset += len(line)
