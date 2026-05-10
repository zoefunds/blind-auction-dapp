"use client";

import { useState, useEffect } from "react";
import { useConnection, useAnchorWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import Header from "@/components/Header";
import Link from "next/link";

export default function Faucet() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const [amount, setAmount] = useState("1");
  const [status, setStatus] = useState("idle");
  const [logs, setLogs] = useState([]);
  const [balance, setBalance] = useState(null);

  const log = (m) => setLogs((l) => [...l, m]);

  useEffect(() => {
    if (wallet) {
      connection.getBalance(wallet.publicKey).then((lamports) => {
        setBalance(lamports / LAMPORTS_PER_SOL);
      }).catch(() => {});
    } else {
      setBalance(null);
    }
  }, [wallet, connection]);

  // Auto-load balance when wallet connects
  if (typeof window !== "undefined") {
    // simple hook-less effect via useEffect import
  }

  async function refreshBalance() {
    if (!wallet) return;
    const lamports = await connection.getBalance(wallet.publicKey);
    setBalance(lamports / LAMPORTS_PER_SOL);
  }

  async function airdrop() {
    if (!wallet) return;
    setStatus("requesting");
    setLogs([]);
    try {
      const sol = parseFloat(amount);
      if (isNaN(sol) || sol <= 0 || sol > 2) {
        log("x amount must be between 0 and 2 SOL (devnet limit)");
        setStatus("error");
        return;
      }
      log("ok requesting airdrop of " + sol + " SOL to " + wallet.publicKey.toBase58().slice(0, 8) + "...");
      const sig = await connection.requestAirdrop(wallet.publicKey, sol * LAMPORTS_PER_SOL);
      log("ok tx sig: " + sig.slice(0, 24) + "...");
      log(".. confirming on devnet");
      await connection.confirmTransaction(sig, "confirmed");
      log("ok confirmed. funds available.");
      await refreshBalance();
      setStatus("done");
    } catch (e) {
      log("x error: " + (e?.message || String(e)));
      log("  devnet faucet rate-limited? try the alt faucets below.");
      setStatus("error");
    }
  }

  return (
    <div>
      <Header />
      <main className="max-w-3xl mx-auto px-6 py-16">
        <Link href="/" className="mono text-xs uppercase tracking-wider text-[var(--dim)] hover:text-[var(--accent)] transition">
          back
        </Link>

        <div className="mono text-xs uppercase tracking-[0.2em] text-[var(--accent)] mt-8 mb-4">
          [faucet]
        </div>
        <h1 className="text-5xl font-bold tracking-tighter">Devnet SOL faucet</h1>
        <p className="mt-4 text-[var(--dim)] max-w-xl">
          Get free Solana devnet SOL to test BlindBid. Auctions, bids, and refunds all use native lamports on Solana Devnet.
        </p>

        <div className="mt-12 grid md:grid-cols-2 gap-12">
          <div className="space-y-6">
            {!wallet && (
              <div className="border border-[var(--line)] p-6 text-sm text-[var(--dim)]">
                connect a wallet to request airdrop.
              </div>
            )}

            {wallet && (
              <>
                <div>
                  <div className="mono text-xs uppercase tracking-wider text-[var(--dim)] mb-1">your wallet</div>
                  <div className="mono text-sm break-all">{wallet.publicKey.toBase58()}</div>
                </div>

                <div>
                  <div className="mono text-xs uppercase tracking-wider text-[var(--dim)] mb-1">current balance</div>
                  <div className="text-3xl font-bold tracking-tighter">
                    {balance === null ? "..." : balance.toFixed(4)}{" "}
                    <span className="text-[var(--dim)] text-base font-normal">SOL</span>
                  </div>
                  <button
                    onClick={refreshBalance}
                    className="mt-2 mono text-[10px] uppercase tracking-wider text-[var(--dim)] hover:text-[var(--accent)] transition"
                  >
                    refresh
                  </button>
                </div>

                <div>
                  <div className="mono text-xs uppercase tracking-wider text-[var(--dim)] mb-1">amount (SOL)</div>
                  <input
                    type="number"
                    step="0.5"
                    min="0.5"
                    max="2"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full bg-transparent border-b-2 border-[var(--line)] focus:border-[var(--accent)] outline-none py-3 text-lg mono transition"
                  />
                  <div className="mono text-[10px] text-[var(--dim)] mt-1">devnet allows up to 2 SOL per request</div>
                </div>

                <button
                  onClick={airdrop}
                  disabled={status === "requesting"}
                  className="mono text-sm uppercase tracking-wider px-6 h-12 w-full bg-[var(--accent)] text-[var(--bg)] hover:bg-[var(--fg)] transition font-bold disabled:opacity-30"
                >
                  {status === "requesting" ? "requesting..." : "request airdrop"}
                </button>
              </>
            )}

            <div className="border border-[var(--line)] p-4 text-xs text-[var(--dim)] mono leading-relaxed">
              <div className="uppercase tracking-wider text-[var(--accent)] mb-2">// alt faucets</div>
              <div>if rate-limited, try:</div>
              <ul className="mt-2 space-y-1">
                <li>
                  <a href="https://faucet.solana.com" target="_blank" rel="noreferrer" className="underline hover:text-[var(--accent)]">faucet.solana.com</a>
                </li>
                <li>
                  <a href="https://solfaucet.com" target="_blank" rel="noreferrer" className="underline hover:text-[var(--accent)]">solfaucet.com</a>
                </li>
                <li>
                  <a href="https://faucet.quicknode.com/solana/devnet" target="_blank" rel="noreferrer" className="underline hover:text-[var(--accent)]">QuickNode devnet faucet</a>
                </li>
              </ul>
            </div>
          </div>

          <div className="border border-[var(--line)] bg-black mono text-xs">
            <div className="border-b border-[var(--line)] px-4 py-2 flex items-center justify-between">
              <span className="text-[var(--dim)] uppercase tracking-wider">// console</span>
              <span className={"flex items-center gap-2 " + (status === "done" ? "text-[var(--accent)]" : status === "error" ? "text-red-400" : "text-[var(--dim)]")}>
                <span className="w-2 h-2 rounded-full bg-current" />
                {status}
              </span>
            </div>
            <div className="p-4 h-72 overflow-auto leading-relaxed">
              {logs.length === 0 ? (
                <div className="text-[var(--dim)]">awaiting command_</div>
              ) : (
                logs.map((l, i) => (
                  <div key={i} className={l.startsWith("ok") ? "text-[var(--accent)]" : l.startsWith("x") ? "text-red-400" : "text-[var(--fg)]/80"}>
                    {l}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
