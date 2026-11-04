from pathlib import Path
p = Path(r"C:\Users\Varad Deshpande\Downloads\KPMPL-Latest\backend\apps\api\src\modules\documents\documents.service.ts")
lines = p.read_bytes().splitlines(True)

for n in range(386, 435):
    if n < len(lines):
        print(f"{n+1:4d}: {lines[n]!r}")
