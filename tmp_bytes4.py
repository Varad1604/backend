from pathlib import Path

path = Path(r"C:\Users\Varad Deshpande\Downloads\KPMPL-Latest\backend\apps\api\src\modules\documents\documents.service.ts")
data = path.read_bytes()
lines = data.splitlines(True)

lineno = 416
col = 24

if 1 <= lineno <= len(lines):
    l = lines[lineno-1]
    print("line", lineno, "len", len(l))
    print("raw:", repr(l))
    print("text:", l.decode("utf-8", "replace").rstrip("\r\n"))
    start = max(0, col-1)
    print("col window:", repr(l[start:start+40].decode("utf-8", "replace")))

# Also show preceding line context by line numbers
print("\npreceding/following lines:")
for n in (413, 414, 415, 416, 417):
    if n <= len(lines):
        print(n, ":", lines[n-1].decode("utf-8", "replace").rstrip("\r\n"))
