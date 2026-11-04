from pathlib import Path

path = Path(r"C:\Users\Varad Deshpande\Downloads\KPMPL-Latest\backend\apps\api\src\modules\documents\documents.service.ts")
data = path.read_bytes()
for needle, label in [
    (b"tx.accountingChecks.findUnique", "ACCCHECKS_OLD"),
    (b"tx.accountingCheck.findUnique", "ACCCHECK_NEW"),
    (b"checksForPackage", "CHECKSFORPACKAGE"),
]:
    off = 0
    while True:
        pos = data.find(needle, off)
        if pos == -1:
            print(f"{label}: NOT FOUND")
            break
        print(f"{label}: offset {pos}  context: {data[max(0,pos-30):pos+len(needle)+30]!r}")
        off = pos + 1
