from pathlib import Path

p = Path("app/app/auction/[pda]/page.tsx")
s = p.read_text()

old = '''            {(resolved || isResolved) && (
              <div className="mt-12 border border-[var(--accent)] p-6">
                <div className="mono text-xs uppercase tracking-wider text-[var(--accent)] mb-4">
                  [resolved]
                </div>
                {resolved ? (
                  <>
                    <div className="text-3xl font-bold tracking-tighter mb-2">
                      Winner pays {resolved.payment} lamports
                    </div>
                    <div className="mono text-xs text-[var(--dim)] break-all">
                      winner: {resolved.winner}
                    </div>
                  </>
                ) : (
                  <div className="text-2xl font-bold">Auction resolved (event already fired)</div>
                )}
              </div>
            )}'''

new = '''            {(resolved || isResolved) && (() => {
              const winnerPk = resolved
                ? resolved.winner
                : auction?.winner?.toBase58?.() ?? null;
              const paymentAmt = resolved
                ? resolved.payment
                : auction?.paymentAmount?.toString?.() ?? null;
              const isAuctionAuthority = wallet && auction && wallet.publicKey.toBase58() === auction.authority.toBase58();
              const winnerIsMe = wallet && winnerPk && (
                winnerPk === wallet.publicKey.toBase58() ||
                winnerPk === Buffer.from(wallet.publicKey.toBytes()).toString("hex")
              );
              return (
                <div className="mt-12 border border-[var(--accent)] p-6">
                  <div className="mono text-xs uppercase tracking-wider text-[var(--accent)] mb-4">
                    [resolved]
                  </div>
                  {winnerPk && paymentAmt ? (
                    <>
                      <div className="text-3xl font-bold tracking-tighter mb-2">
                        Winner pays {paymentAmt} lamports
                      </div>
                      <div className="mono text-xs text-[var(--dim)] break-all mb-3">
                        winner: {winnerPk}
                      </div>
                      {winnerIsMe && (
                        <div className="mono text-xs text-[var(--accent)] mb-2">
                          ★ you won this auction
                        </div>
                      )}
                      {isAuctionAuthority && (
                        <div className="mono text-[10px] text-[var(--dim)] mt-3 pt-3 border-t border-[var(--line)] leading-relaxed">
                          you are the auction authority. contact the winner off-chain
                          (their wallet pubkey is shown above) to coordinate delivery.
                          the winner&apos;s {paymentAmt}-lamport payment is held in the
                          auction PDA; remaining bidder deposits will be refunded when
                          they each call claim_refund.
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-2xl font-bold">Auction resolved</div>
                  )}
                </div>
              );
            })()}'''

if old in s:
    p.write_text(s.replace(old, new))
    print("patched resolved view")
elif "you are the auction authority" in s:
    print("already patched")
else:
    print("target block not found")
