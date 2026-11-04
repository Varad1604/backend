import sys

path = r"C:\Users\Varad Deshpande\Downloads\KPMPL-Latest\backend\apps\api\src\modules\documents\documents.service.ts"
data = open(path, "rb").read()

needle = b"source: 'app'"
idx = 0
count = 0
while True:
    i = data.find(needle, idx)
    if i < 0:
        break
    start = max(0, i - 260)
    end = min(len(data), i + 80)
    print(f"\n--- occurrence {count} at byte {i} ---")
    print(repr(data[start:end]))
    count += 1
    idx = i + 1
    if count > 8:
        break
