import sys

path = r"C:\Users\Varad Deshpande\Downloads\KPMPL-Latest\backend\apps\api\src\modules\documents\documents.service.ts"
data = open(path, "rb").read()

needle = b"` \xe2\x80\x94 ${c.note}` : '')\n      ).join('; ');\n"
idx = data.find(needle)
if idx < 0:
    print("NEEDLE NOT FOUND", file=sys.stderr)
    sys.exit(1)

# This file currently uses LF-only line endings, so the needle above should match.
replacement = b"` \xe2\x80\x94 ${c.note}` : '')\n      ).join('; ');\n"
open(path, "wb").write(data[:idx] + replacement + data[idx + len(needle):])
print("PATCHED")
