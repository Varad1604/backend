from pathlib import Path

p = Path(r"C:\Users\Varad Deshpande\Downloads\KPMPL-Latest\backend\apps\api\src\modules\documents\documents.service.ts")
lines = p.read_bytes().splitlines(True)
for n in range(355, 425):
    if n < len(lines):
        line = lines[n].decode("utf-8", "replace").rstrip("\r\n")
        print(f"{n+1:4d}: {line}")
