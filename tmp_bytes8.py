from pathlib import Path

path = Path(r"C:\Users\Varad Deshpande\Downloads\KPMPL-Latest\backend\apps\api\src\modules\documents\documents.service.ts")
data = path.read_bytes()
lines = data.splitlines(True)

print("lines 405..420:")
off = 0
for n in range(405, 421):
    if n <= len(lines):
        l = lines[n-1]
        print(f"\nline {n} @byte {off} (len {len(l)}):")
        print("  raw:", repr(l))
        print("  text:", l.decode("utf-8", "replace").rstrip("\r\n"))
    off += len(l)

print("\ntsc target context (line414..418 joined):")
seg = b"".join(lines[413:418]).decode("utf-8", "replace")
print(repr(seg))
