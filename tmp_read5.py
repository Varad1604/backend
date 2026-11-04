from pathlib import Path

p = Path(r"C:\Users\Varad Deshpande\Downloads\KPMPL-Latest\backend\apps\api\src\modules\documents\documents.service.ts")
data = p.read_bytes()

lines = data.splitlines(True)

print("tsc reports line 416 col 24. Showing lines 410..420.")
for n in range(410, 421):
    if n <= len(lines):
        l = lines[n-1]
        print(f"--- line {n} ---")
        print("raw:", repr(l))
        print("dec:", l.decode("utf-8", "replace").rstrip("\r\n"))
        if n == 416:
            print("col24 region:", repr(l[23:34].decode("utf-8", "replace")))

# Show the preceding full expression lines as they exist in file bytes
print("\nByte slice around line 414-416:")
for n in (414, 415, 416):
    print(f"line {n} bytes:", lines[n-1])
