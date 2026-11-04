import sys

path = r"C:\Users\Varad Deshpande\Downloads\KPMPL-Latest\backend\apps\api\src\modules\documents\documents.service.ts"
data = open(path, "rb").read()

print("total bytes:", len(data))
print("LF count:", data.count(b"\n"))
print("CRLF count:", data.count(b"\r\n"))
print("CR count:", data.count(b"\r"))

# Find all occurrences of .join( and show context
i = 0
count = 0
while True:
    idx = data.find(b".join(", i)
    if idx < 0:
        break
    start = max(0, idx - 30)
    end = min(len(data), idx + 60)
    seg = data[max(0, idx-200):idx+80]
    print(f"\n--- occurrence {count} at byte {idx} ---")
    print(repr(seg))
    sys.stdout.flush()
    count += 1
    i = idx + 1
    if count > 20:
        print("... stopping after 20 occurrences")
        break
