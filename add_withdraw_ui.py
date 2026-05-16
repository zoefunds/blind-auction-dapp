from pathlib import Path
p = Path("app/app/auction/[pda]/page.tsx")
s = p.read_text()

# 1) Add proceedsWithdrawn state alongside other useState calls
old1 = '  const [resolved, setResolved] = useState(null);'
new1 = '''  const [resolved, setResolved] = useState(null);
  const [proceedsWithdrawn, setProceedsWithdrawn] = useState(false);'''
if "proceedsWithdrawn" not in s:
    s = s.replace(old1, new1)

# 2) Add effect: poll proceeds PDA to know if already withdrawn
old2 = '''  useEffect(() => {
    if (!wallet || !pda) return;
    const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
    const program = new Program(idl, provider);
    const [receiptPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("receipt"), new PublicKey(pda).toBuffer(), wallet.publicKey.toBuffer()],
      PROGRAM_ID
    );
    program.account.bidReceipt.fetch(receiptPDA).then((r) => {
      setHasReceipt(true);
      setReceiptClaimed(r.claimed);
    }).catch(() => {
      setHasReceipt(false);
      setReceiptClaimed(false);
    });
  }, [wallet, pda, connection, auction]);'''
new2 = old2 + '''

  useEffect(() => {
    if (!pda) return;
    const [proceedsPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("proceeds"), new PublicKey(pda).toBuffer()],
      PROGRAM_ID
    );
    connection.getAccountInfo(proceedsPDA).then((a) => setProceedsWithdrawn(!!a)).catch(() => setProceedsWithdrawn(false));
  }, [pda, connection, auction]);'''
if "proceeds PDA" not in s and 'Buffer.from("proceeds")' not in s:
    s = s.replace(old2, new2)

# 3) Add withdrawProceeds() function before closeAuction()
old3 = '  async function closeAuction() {'
new3 = '''  async function withdrawProceeds() {
    if (!wallet || !auction) return;
    setStatus("submitting");
    setLogs([]);
    try {
      const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
      const program = new Program(idl, provider);
      const [proceedsPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("proceeds"), new PublicKey(pda).toBuffer()],
        PROGRAM_ID
      );
      log("-> withdrawing proceeds");
      const tx = await program.methods
        .withdrawProceeds()
        .accountsPartial({
          authority: wallet.publicKey,
          auction: new PublicKey(pda),
          proceedsClaim: proceedsPDA,
        })
        .transaction();
      tx.feePayer = wallet.publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
      const signed = await wallet.signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: true });
      await connection.confirmTransaction(sig, "confirmed");
      log("ok withdraw tx: " + sig.slice(0, 24));
      log("ok " + auction.paymentAmount.toString() + " lamports sent to authority");
      setProceedsWithdrawn(true);
      setStatus("done");
    } catch (e) {
      log("x error: " + (e?.message || String(e)));
      setStatus("error");
    }
  }

  async function closeAuction() {'''
if "withdrawProceeds()" not in s:
    s = s.replace(old3, new3)

# 4) Add withdraw button in the authority-section of the resolved view
old4 = '''                      {isAuctionAuthority && (
                        <div className="mono text-[10px] text-[var(--dim)] mt-3 pt-3 border-t border-[var(--line)] leading-relaxed">
                          you are the auction authority. contact the winner off-chain
                          (their wallet pubkey is shown above) to coordinate delivery.
                          the winner&apos;s {paymentAmt}-lamport payment is held in the
                          auction PDA; remaining bidder deposits will be refunded when
                          they each call claim_refund.
                        </div>
                      )}'''
new4 = '''                      {isAuctionAuthority && (
                        <div className="mt-3 pt-3 border-t border-[var(--line)]">
                          {proceedsWithdrawn ? (
                            <div className="mono text-[10px] text-[var(--dim)] leading-relaxed">
                              ✓ proceeds withdrawn. contact the winner off-chain to
                              coordinate delivery.
                            </div>
                          ) : (
                            <>
                              <div className="mono text-[10px] text-[var(--dim)] mb-3 leading-relaxed">
                                you are the auction authority. {paymentAmt} lamports
                                of winner payment are held in the auction PDA.
                                withdraw to your wallet, then contact the winner
                                off-chain to deliver the item.
                              </div>
                              <button
                                onClick={withdrawProceeds}
                                disabled={status === "submitting"}
                                className="mono text-xs uppercase tracking-wider px-4 h-10 bg-[var(--accent)] text-[var(--bg)] hover:bg-[var(--fg)] transition font-bold disabled:opacity-30"
                              >
                                {status === "submitting" ? "withdrawing..." : "withdraw " + paymentAmt + " lamports"}
                              </button>
                            </>
                          )}
                        </div>
                      )}'''
if "withdraw_proceeds" not in s.lower() or "withdrawProceeds" not in s.split("button")[0]:
    s = s.replace(old4, new4)

p.write_text(s)
print("patched", p)
