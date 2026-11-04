from pathlib import Path
p = Path(r"C:\Users\Varad Deshpande\Downloads\KPMPL-Latest\backend\apps\api\src\modules\documents\documents.service.ts")
data = p.read_bytes()
lines = data.splitlines(True)

needle = b"this.view(tx, row)"
off = 0
hits = 0
while True:
    pos = data.find(needle, off)
    if pos == -1:
        break
    start = pos - 200
    end = pos + len(needle) + 120
    print(f"hit {hits+1} @ {pos}")
    print(data[start:end])
    print("=" * 70)
    hits += 1
    off = pos + 1
print("total hits", hits)
