from pathlib import Path

# === 1. CREATE PAGE — min bid in SOL ===
p = Path("app/app/create/page.tsx")
s = p.read_text()
s = s.replace(
    'const [minBid, setMinBid] = useState("100");',
    'const [minBid, setMinBid] = useState("0.0001");'
)
s = s.replace(
    "new BN(minBid)",
    'new BN(Math.round(parseFloat(minBid || "0") * 1e9))'
)
s = s.replace(
    'label="Minimum bid" sub="Lamports. 1 SOL = 1,000,000,000 lamports. 1 SOL = 1,000,000,000."',
    'label="Minimum bid (SOL)" sub="Lowest bid the auction will accept."'
)
# Also widen the number input to accept decimals (step=any)
s = s.replace(
    '''<input
                type="number"
                value={minBid}
                onChange={(e) => setMinBid(e.target.value)}
                className="w-full bg-transparent border-b-2 border-[var(--line)] focus:border-[var(--accent)] outline-none py-3 text-lg mono transition"
              />''',
    '''<input
                type="number"
                step="any"
                min="0"
                value={minBid}
                onChange={(e) => setMinBid(e.target.value)}
                className="w-full bg-transparent border-b-2 border-[var(--line)] focus:border-[var(--accent)] outline-none py-3 text-lg mono transition"
              />'''
)
p.write_text(s)
print("[1] create page → SOL")

# === 2. AUCTION DETAIL — bid + deposit in SOL, auto-sync deposit ===
p = Path("app/app/auction/[pda]/page.tsx")
s = p.read_text()

s = s.replace(
    'const [bidAmount, setBidAmount] = useState("500");',
    'const [bidAmount, setBidAmount] = useState("0.001");'
)
s = s.replace(
    'const [depositAmount, setDepositAmount] = useState("1000");',
    'const [depositAmount, setDepositAmount] = useState("0.002");\n  const [depositTouched, setDepositTouched] = useState(false);'
)

# placeBid: convert SOL → lamports for encryption + deposit
s = s.replace(
    'const plaintext = [bidderLo, bidderHi, BigInt(bidAmount)];',
    'const bidLamports = BigInt(Math.round(parseFloat(bidAmount || "0") * 1e9));\n      const plaintext = [bidderLo, bidderHi, bidLamports];'
)
s = s.replace(
    'log("ok encrypted [bidder_lo, bidder_hi, amount=" + bidAmount + "]");',
    'log("ok encrypted bid (" + bidAmount + " SOL = " + bidLamports.toString() + " lamports)");'
)
s = s.replace(
    "new BN(depositAmount)",
    'new BN(Math.round(parseFloat(depositAmount || "0") * 1e9))'
)

# Display min bid in SOL
s = s.replace(
    'Row k="min bid" v={auction.minBid.toString() +  " lamports"}',
    'Row k="min bid" v={(auction.minBid.toNumber() / 1e9) + " SOL"}'
)

# Rewrite the bid+deposit input block: clearer labels, auto-sync
old_block = '''<div className="mono text-[10px] uppercase text-[var(--dim)] mb-1">bid amount (encrypted)</div>
                <input
                  type="number"
                  value={bidAmount}
                  onChange={(e) => setBidAmount(e.target.value)}
                  placeholder="lamports"
                  className="w-full bg-transparent border-b-2 border-[var(--line)] focus:border-[var(--accent)] outline-none py-3 text-lg mono transition"
                />
                <div className="mono text-[10px] uppercase text-[var(--dim)] mt-4 mb-1">deposit (escrowed in PDA, must be ≥ bid)</div>
                <input
                  type="number"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  placeholder="lamports"
                  className="w-full bg-transparent border-b-2 border-[var(--line)] focus:border-[var(--accent)] outline-none py-3 text-lg mono transition"
                />'''
new_block = '''<div className="mono text-[10px] uppercase text-[var(--dim)] mb-1">your bid (SOL, secret)</div>
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={bidAmount}
                  onChange={(e) => {
                    const v = e.target.value;
                    setBidAmount(v);
                    if (!depositTouched) {
                      const b = parseFloat(v || "0");
                      setDepositAmount(b > 0 ? (b * 2).toString() : "");
                    }
                  }}
                  placeholder="0.001"
                  className="w-full bg-transparent border-b-2 border-[var(--line)] focus:border-[var(--accent)] outline-none py-3 text-lg mono transition"
                />
                <div className="mono text-[10px] uppercase text-[var(--dim)] mt-4 mb-1">deposit (SOL, public, must be ≥ bid)</div>
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={depositAmount}
                  onChange={(e) => { setDepositAmount(e.target.value); setDepositTouched(true); }}
                  placeholder="0.002"
                  className="w-full bg-transparent border-b-2 border-[var(--line)] focus:border-[var(--accent)] outline-none py-3 text-lg mono transition"
                />'''
s = s.replace(old_block, new_block)

# Bottom-of-form hint: cleaner copy
s = s.replace(
    "your bid is encrypted; deposit is escrowed in plaintext. losers reclaim deposit; winners reclaim deposit minus winning bid.",
    "your bid is encrypted; deposit is escrowed publicly and auto-set to 2× your bid to hide it. losers reclaim full deposit; winner reclaims deposit minus winning bid."
)

# Helper inserted once near the top of the component
helper_marker = "function splitPubkeyToU128s(pubkey) {"
helper_def = '''function lamportsToSol(lamports) {
  const n = Number(lamports?.toString?.() ?? lamports ?? 0);
  return (n / 1e9).toFixed(9).replace(/\\.?0+$/, "");
}

function splitPubkeyToU128s(pubkey) {'''
if "function lamportsToSol" not in s:
    s = s.replace(helper_marker, helper_def)

# Resolved-view displays: lamports → SOL
s = s.replace(
    "Winner pays {paymentAmt} lamports",
    "Winner pays {lamportsToSol(paymentAmt)} SOL"
)
s = s.replace(
    "the winner&apos;s {paymentAmt}-lamport payment",
    "the winner&apos;s {lamportsToSol(paymentAmt)} SOL payment"
)
s = s.replace(
    "{paymentAmt} lamports of winner payment are held",
    "{lamportsToSol(paymentAmt)} SOL of winner payment is held"
)
s = s.replace(
    '"withdraw " + paymentAmt + " lamports"',
    '"withdraw " + lamportsToSol(paymentAmt) + " SOL"'
)
s = s.replace(
    'log("ok " + auction.paymentAmount.toString() + " lamports sent to authority");',
    'log("ok " + lamportsToSol(auction.paymentAmount) + " SOL sent to authority");'
)

p.write_text(s)
print("[2] auction detail → SOL + auto-deposit")

# === 3. BROWSE PAGE — min bid in SOL (if file shows lamports) ===
p = Path("app/app/auctions/page.tsx")
if p.exists():
    s = p.read_text()
    before = s
    s = s.replace('.minBid.toString() + " lamports"', '(.minBid.toNumber() / 1e9) + " SOL"')
    # fallback patterns
    s = s.replace('minBid.toString() + " lamports"', '(minBid.toNumber() / 1e9) + " SOL"')
    if s != before:
        p.write_text(s)
        print("[3] browse page → SOL")
    else:
        print("[3] browse page: no lamports display to patch")
