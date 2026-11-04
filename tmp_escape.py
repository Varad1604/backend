from pathlib import Path

path = Path(r"C:\Users\Varad Deshpande\Downloads\KPMPL-Latest\backend\apps\api\src\modules\documents\documents.service.ts")
data = path.read_bytes()

# The scarred region: lines 407..421 inclusive are a duplicate headAccountantCases fragment and a stray
# duplicate of the first two lines of preceding method. Remove lines 407..421 inclusive (1-indexed),
# keeping exactly one trailing blank line.
lines = data.splitlines(True)

start = 407 - 1
end = 421  # exclusive (lines up to and including 421 removed)

before = data[: sum(len(l) for l in lines[:start])]
after = data[ sum(len(l) for l in lines[:end]) : ]

new = before + b"\n" + after if not before.endswith(b"\n") else before + after
path.write_bytes(new)
print("TRIMMED 407..421")
