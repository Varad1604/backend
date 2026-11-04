import sys

path = r"C:\Users\Varad Deshpande\Downloads\KPMPL-Latest\backend\apps\api\src\modules\documents\documents.service.ts"
data = open(path, "rb").read()

before = data
# Replace the three-line template expression with an explicit builder
old = (
    b"      const detail = input.checks.map(c =>\n"
    b"        ` ${c.type === 'bill_passed' ? 'Bill' : c.type === 'gst_checked' ? 'GST' : 'TDS'}: ${c.status}` +\n"
    b"        (c.note ? ` \xe2\x80\x94 ${c.note}` : '')\n"
    b"      ).join('; ');"
)
new = (
    b"      const detailParts: string[] = [];\n"
    b"      for (const c of input.checks) {\n"
    b"        const label = c.type === 'bill_passed' ? 'Bill' : c.type === 'gst_checked' ? 'GST' : 'TDS';\n"
    b"        let part = `${label}: ${c.status}`;\n"
    b"        if (c.note) part += ` \xe2\x80\x94 ${c.note}`;\n"
    b"        detailParts.push(part);\n"
    b"      }\n"
    b"      const detail = detailParts.join('; ');"
)

idx = data.find(old)
if idx < 0:
    print("OLD BLOCK NOT FOUND", file=sys.stderr)
    sys.exit(1)

data = data[:idx] + new + data[idx + len(old):]
open(path, "wb").write(data)

if data == before:
    print("NO CHANGE", file=sys.stderr)
    sys.exit(2)
print("PATCHED")
