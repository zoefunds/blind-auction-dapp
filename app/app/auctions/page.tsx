"use client";

import { useEffect, useState } from "react";
import { useConnection, useAnchorWallet } from "@solana/wallet-adapter-react";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import idl from "@/lib/anchor/auction.json";
import Header from "@/components/Header";
import Link from "next/link";

const PROGRAM_ID = new PublicKey("C1L6yaUgu9rGbfbDzP61iyaqRrPrTJoUopMmjgLoVYzz");

export default function Auctions() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const [auctions, setAuctions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const provider = new AnchorProvider(
          connection,
          wallet || { publicKey: PublicKey.default, signTransaction: async (t) => t, signAllTransactions: async (t) => t },
          { commitment: "confirmed" }
        );
        const program = new Program(idl, provider);
        const all = await program.account.auction.all();
        setAuctions(all.map((a) => ({ pda: a.publicKey.toBase58(), ...a.account })));
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [connection, wallet]);

  const filtered = auctions.filter((a) => {
    const isOpen = a.status?.open !== undefined;
    const isClosed = a.status?.closed !== undefined;
    const isResolved = a.status?.resolved !== undefined;
    if (filter === "open") return isOpen;
    if (filter === "closed") return isClosed;
    if (filter === "resolved") return isResolved;
    return true;
  }).sort((a, b) => b.endTime.toNumber() - a.endTime.toNumber());

  return (
    <div>
      <Header />
      <main className="max-w-6xl mx-auto px-6 py-12">
        <div className="mono text-xs uppercase tracking-[0.2em] text-[var(--accent)] mb-4">
          [browse]
        </div>
        <h1 className="text-5xl font-bold tracking-tighter">All auctions</h1>
        <div className="mt-2 text-[var(--dim)]">
          {auctions.length} total on chain
        </div>

        <div className="mt-8 flex gap-2 mono text-xs uppercase">
          {["all", "open", "closed", "resolved"].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={"px-4 h-10 border transition " + (filter === f ? "border-[var(--accent)] text-[var(--accent)]" : "border-[var(--line)] hover:border-[var(--dim)]")}
            >
              {f}
            </button>
          ))}
        </div>

        <div className="mt-8 border border-[var(--line)]">
          {loading ? (
            <div className="p-12 text-center mono text-sm text-[var(--dim)]">loading on-chain state...</div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center mono text-sm text-[var(--dim)]">no auctions match filter</div>
          ) : (
            filtered.map((a) => {
              const isOpen = a.status?.open !== undefined;
              const isClosed = a.status?.closed !== undefined;
              const isResolved = a.status?.resolved !== undefined;
              const endTime = a.endTime.toNumber();
              const remaining = Math.max(0, endTime - now);
              const isFirstPrice = a.auctionType?.firstPrice !== undefined;
              return (
                <Link
                  key={a.pda}
                  href={"/auction/" + a.pda}
                  className="block border-b border-[var(--line)] last:border-0 hover:bg-[var(--line)]/30 transition"
                >
                  <div className="px-6 py-5 grid grid-cols-12 gap-4 items-center">
                    <div className="col-span-5 mono text-sm break-all">
                      {a.pda.slice(0, 16)}...{a.pda.slice(-6)}
                    </div>
                    <div className="col-span-2 mono text-xs uppercase">
                      <span className={isOpen ? "text-[var(--accent)]" : isClosed ? "text-yellow-400" : "text-[var(--dim)]"}>
                        ● {isOpen ? "open" : isClosed ? "closed" : "resolved"}
                      </span>
                    </div>
                    <div className="col-span-2 mono text-xs text-[var(--dim)]">
                      {isFirstPrice ? "first-price" : "vickrey"}
                    </div>
                    <div className="col-span-2 mono text-xs">
                      {String(a.bidCount)} bid{a.bidCount !== 1 ? "s" : ""}
                    </div>
                    <div className="col-span-1 mono text-xs text-right">
                      {isOpen && remaining > 0 ? (
                        <span className="text-[var(--accent)]">{Math.floor(remaining / 60)}m{remaining % 60}s</span>
                      ) : (
                        <span className="text-[var(--dim)]">ended</span>
                      )}
                    </div>
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </main>
    </div>
  );
}
