from pathlib import Path

p = Path(r"C:\Users\Varad Deshpande\Downloads\KPMPL-Latest\backend\apps\api\src\modules\documents\documents.service.ts")
data = p.read_bytes()

lines = data.splitlines(True)

def show(lineno):
    if 1 <= lineno <= len(lines):
        l = lines[lineno - 1]
        print(f"line {lineno}: {l!r}")
        print("   decoded:", l.decode("utf-8", "replace").rstrip("\r\n"))
    else:
        print(f"line {lineno}: out of range")

for n in (413, 414, 415, 416, 417):
    show(n)

# Show the exact tsc-reported slice on line 416
l416 = lines[415]
print("\nline416 prefix 30:", l416[:30].decode("utf-8", "replace"))
print("line416 col24:", l416[23:30].decode("utf-8", "replace"))
