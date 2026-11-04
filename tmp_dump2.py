import sys

path = r"C:\Users\Varad Deshpande\Downloads\KPMPL-Latest\backend\apps\api\src\modules\documents\documents.service.ts"
data = open(path, "rb").read()

i = 0
count = 0
while True:
    idx = data.find(b"'app' })", i)
    if idx < 0:
        break
    start = max(0, idx - 260)
    end = min(len(data), idx + 120)
    seg = data[start:end]
    print(f"\n--- occurrence {count} at byte {idx} ---")
    print(repr(seg))
    count += 1
    i = idx + 1
    if count > 6:
        break
