from pathlib import Path

p = Path(r"C:\Users\Varad Deshpande\Downloads\KPMPL-Latest\backend\apps\api\src\modules\documents\documents.service.ts")
data = p.read_bytes()
lines = data.splitlines(True)

offset = 0
for n in range(405, 425):
    if n <= len(lines):
        l = lines[n-1]
        print(f"line {n} @byte {offset} (len {len(l)}):")
        print("  raw:", repr(l))
        try:
            print("  dec:", l.decode("utf-8"))
        except Exception as e:
            print("  decode err:", e)
        offset += len(l)
