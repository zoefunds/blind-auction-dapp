import json, subprocess
from pathlib import Path

# 1) Generate fresh program keypair, overwriting the existing one
old_kp = Path("programs/auction/target/deploy/auction-keypair.json")
old_kp.parent.mkdir(parents=True, exist_ok=True)
subprocess.run(
    ["solana-keygen", "new", "--no-bip39-passphrase", "--silent", "--force", "-o", str(old_kp)],
    check=True,
)
new_id = subprocess.check_output(["solana-keygen", "pubkey", str(old_kp)]).decode().strip()
print(f"new program id: {new_id}")

OLD_ID = "C1L6yaUgu9rGbfbDzP61iyaqRrPrTJoUopMmjgLoVYzz"

targets = [
    "programs/auction/programs/auction/src/lib.rs",
    "programs/auction/Anchor.toml",
    "app/lib/anchor/client.ts",
    "app/app/auction/[pda]/page.tsx",
    "app/app/create/page.tsx",
    "app/lib/anchor/auction.json",
]

for t in targets:
    p = Path(t)
    if not p.exists():
        print(f"  (skip, not found) {t}")
        continue
    s = p.read_text()
    if OLD_ID in s:
        p.write_text(s.replace(OLD_ID, new_id))
        print(f"  patched {t}")
    else:
        print(f"  (no match) {t}")

# Save new id for later reference
Path(".new_program_id").write_text(new_id + "\n")
print(f"\nremember: new program id is {new_id}")
