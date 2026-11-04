from pathlib import Path

p = Path(r"C:\Users\Varad Deshpande\Downloads\KPMPL-Latest\backend\apps\api\src\modules\documents\documents.service.ts")
data = p.read_bytes()
lines = data.splitlines(True)

for n in range(408, 421):
    if n <= len(lines):
        l = lines[n-1]
        print(f"--- line {n} ---")
        print("raw:", repr(l))
        print("dec:", l.decode("utf-8", "replace").rstrip("\r\n"))
