from pathlib import Path

path = Path(r"C:\Users\Varad Deshpande\Downloads\KPMPL-Latest\backend\apps\api\src\modules\documents\documents.service.ts")
data = path.read_bytes()

lines = data.splitlines(True)

print("Total bytes:", len(data))
print("LF:", data.count(b"\n"), "CR:", data.count(b"\r"), "CRLF:", data.count(b"\r\n"))
print()

# Print lines 410..420 with byte offsets and a highlighted tsc position
off = 0
for idx, l in enumerate(lines, start=1):
    if 410 <= idx <= 420:
        print(f"--- line {idx} @byte {off} (len {len(l)}) ---")
        print("raw:", repr(l))
        print("text:", l.decode("utf-8", "replace").rstrip("\r\n"))
        if idx == 416:
            print("col24 region:", repr(l[23:34].decode("utf-8", "replace")))
    off += len(l)

print()
print("Byte window around tsc target (line416 col24):")
target = sum(len(lines[i]) for i in range(415)) + 23
print("target byte index:", target)
print(repr(data[target-20:target+20]))
