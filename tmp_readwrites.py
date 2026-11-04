from pathlib import Path

for rel in [
    r"backend\apps\api\src\modules\platform\idempotent-write.service.ts",
    r"backend\apps\api\src\modules\platform\writes.module.ts",
]:
    p = Path(relative_to_root(rel))
    if not p.exists():
        print("MISSING", rel)
        continue
    print("FILE", rel, "size", p.stat().st_size)
    print(p.read_text("utf-8").rstrip("\r\n"))
    print("\n===\n")

from pathlib import Path as Path2
def relative_to_root(rel: str):
    return Path(r"C:\Users\Varad Deshpande\Downloads\KPMPL-Latest") / rel.replace(r"\\", "/")


from pathlib import Path as P
import pathlib
