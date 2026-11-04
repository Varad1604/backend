from pathlib import Path

p = Path(r"C:\Users\Varad Deshpande\Downloads\KPMPL-Latest\backend\apps\api\src\modules\documents\documents.service.ts")
data = p.read_bytes()

# tsc says line 416, col 24
lines = data.splitlines(True)
lineno = 416
if 1 <= lineno <= len(lines):
    line = lines[lineno - 1]
    print(f"line {lineno} raw: {line!r}")
    print(f"line {lineno} text: {line.decode('utf-8', 'replace')!r}")
    col = 24
    print(f"chars around col {col}: {line[:col+10].decode('utf-8', 'replace')!r}")

# Also show a slightly wider window using byte offsets
offset = 0
for idx, l in enumerate(lines):
    if 410 <= idx + 1 <= 420:
        print(f"@byte {offset}: {repr(l)}")
    offset += len(l)
