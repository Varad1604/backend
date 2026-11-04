from pathlib import Path

path = Path(r"C:\Users\Varad Deshpande\Downloads\KPMPL-Latest\backend\apps\api\src\modules\documents\documents.service.ts")
data = path.read_bytes()

lines = data.splitlines(True)

print("lines 405..420 with byte offsets:")
off = 0
for idx, l in enumerate(lines, start=1):
    if 405 <= idx <= 420:
        print(f"\n--- line {idx} @byte {off} (len {len(l)}) ---")
        print("raw:", repr(l))
        print("text:", l.decode("utf-8", "replace").rstrip("\r\n"))
    off += len(l)

# Now compute the tsc exact byte: line416 col24 -> 1-based index inside line416
if 416 <= len(lines):
    l416 = lines[415]
    col_start = sum(len(lines[i]) for i in range(415)) + 23  # col24 is index 23 (0-based)
    print("\ntsc exact window around line416 col24:")
    print(repr(data[col_start-30:col_start+30]))
