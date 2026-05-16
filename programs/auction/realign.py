from pathlib import Path
OLD = "Hm2pY2UHjCqob25RXdu6XsbWSeGcoBWrwuiyyx8PFmZ3"
NEW = "AJF599kYegNnhobCvz74yXK7oFrXpafQJN5R8MERvjFU"
targets = [
    "programs/auction/programs/auction/src/lib.rs",
    "programs/auction/Anchor.toml",
    "app/lib/anchor/client.ts",
    "app/app/auction/[pda]/page.tsx",
    "app/app/create/page.tsx",
    "app/lib/anchor/auction.json",
    ".new_program_id",
]
for t in targets:
    p = Path(t)
    if not p.exists():
        print(f"  (skip) {t}"); continue
    s = p.read_text()
    if OLD in s:
        p.write_text(s.replace(OLD, NEW))
        print(f"  patched {t}")
    else:
        print(f"  (no match) {t}")
