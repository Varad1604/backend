import subprocess, re
from pathlib import Path

path = Path(r"C:\Users\Varad Deshpande\Downloads\KPMPL-Latest\backend\apps\api\src\modules\documents\documents.service.ts")
data = path.read_bytes()
lines = data.splitlines(True)

proc = subprocess.run(
    ["pnpm", "--filter", "@kpmpl/api", "exec", "tsc", "-p", "tsconfig.build.json", "--noEmit"],
    cwd=r"C:\Users\Varad Deshpande\Downloads\KPMPL-Latest\backend",
    capture_output=True, text=True, timeout=280
)

out = proc.stdout + proc.stderr
print("EXIT:", proc.returncode)
print("TSC OUTPUT:")
print(out)

for m in re.finditer(r"\((\d+),(\d+)\): error TS\d+", out):
    lineno, colno = int(m.group(1)), int(m.group(2))
    def line_at(n):
        if 1 <= n <= len(lines):
            return lines[n-1].decode("utf-8", "replace").rstrip("\r\n")
        return "<out of range>"
    print("\n=== flagged line", lineno, "col", colno, "===")
    print("line content:", repr(line_at(lineno)))
    if 1 <= lineno <= len(lines):
        l = lines[lineno-1]
        start = max(0, colno-1)
        print("colwindow:", repr(l[start:start+40].decode("utf-8", "replace")))
