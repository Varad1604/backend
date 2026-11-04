from pathlib import Path
candidates = [
    r"C:\Users\Varad Deshpande\Downloads\KPMPL-Latest\backend\apps\api\src\infra\prisma\prisma-singleton.ts",
    r"C:\Users\Varad Deshpande\Downloads\KPMPL-Latest\backend\apps\api\src\modules\documents\prisma-singleton.ts",
]
for c in candidates:
    p = Path(c)
    print(c, "exists:", p.exists())
    if p.exists():
        print(p.read_bytes()[:400])
