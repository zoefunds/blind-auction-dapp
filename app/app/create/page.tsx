"use client";

import { useState } from "react";
import { useConnection, useAnchorWallet } from "@solana/wallet-adapter-react";
import { AnchorProvider, Program, BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { randomBytes } from "crypto";
import {
  getCompDefAccOffset,
  getMXEAccAddress,
  getMempoolAccAddress,
  getCompDefAccAddress,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  getClusterAccAddress,
} from "@arcium-hq/client";
import idl from "@/lib/anchor/auction.json";
import Header from "@/components/Header";
import Link from "next/link";

const PROGRAM_ID = new PublicKey("AJF599kYegNnhobCvz74yXK7oFrXpafQJN5R8MERvjFU");
const ARCIUM_CLUSTER_OFFSET = 456; // Devnet

type Status = "idle" | "signing" | "submitting" | "computing" | "done" | "error";

export default function Create() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const [name, setName] = useState("");
  const [minBid, setMinBid] = useState("0.0001");
  const [duration, setDuration] = useState("300");
  const [auctionType, setAuctionType] = useState("firstPrice");
  const [status, setStatus] = useState("idle");
  const [logs, setLogs] = useState([]);
  const [result, setResult] = useState(null);

  const log = (m) => setLogs((l) => [...l, m]);

  async function createAuction() {
    if (!wallet) return;
    setStatus("signing");
    setLogs([]);
    setResult(null);
    try {
      const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
      const program = new Program(idl, provider);

      // Use timestamp as nonce so each auction gets a unique PDA
      const auctionNonce = new BN(Date.now());
      const nonceBytes = auctionNonce.toArrayLike(Buffer, "le", 8);
      const [auctionPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("auction"), wallet.publicKey.toBuffer(), nonceBytes],
        PROGRAM_ID
      );
      log("ok generated auction nonce: " + auctionNonce.toString());

      log("ok derived auction PDA: " + auctionPDA.toBase58());
      const computationOffset = new BN(randomBytes(8), "hex");

      log("ok building createAuction tx");
      const tx = await program.methods
        .createAuction(
          computationOffset,
          auctionNonce,
          { [auctionType]: {} },
          new BN(Math.round(parseFloat(minBid || "0") * 1e9)),
          new BN(duration)
        )
        .accountsPartial({
          authority: wallet.publicKey,
          auction: auctionPDA,
          computationAccount: getComputationAccAddress(ARCIUM_CLUSTER_OFFSET, computationOffset),
          clusterAccount: getClusterAccAddress(ARCIUM_CLUSTER_OFFSET),
          mxeAccount: getMXEAccAddress(PROGRAM_ID),
          mempoolAccount: getMempoolAccAddress(ARCIUM_CLUSTER_OFFSET),
          executingPool: getExecutingPoolAccAddress(ARCIUM_CLUSTER_OFFSET),
          compDefAccount: getCompDefAccAddress(
            PROGRAM_ID,
            Buffer.from(getCompDefAccOffset("init_auction_state")).readUInt32LE()
          ),
        })
        .transaction();

      tx.feePayer = wallet.publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;

      setStatus("signing");
      log("-> requesting signature from wallet");
      const signed = await wallet.signTransaction(tx);

      setStatus("submitting");
      log("-> sending to devnet");
      const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: true });
      log("ok tx sig: " + sig.slice(0, 24) + "...");

      setStatus("computing");
      log(".. confirming transaction");
      await connection.confirmTransaction(sig, "confirmed");
      log("ok confirmed on devnet");
      log(".. Arx Nodes computing init_auction_state via MPC");
      log("   (takes ~30-60s)");

      let attempts = 0;
      while (attempts < 60) {
        await new Promise((r) => setTimeout(r, 2000));
        const acc = await connection.getAccountInfo(auctionPDA);
        if (acc) {
          const stateBytes = acc.data.slice(77, 77 + 32);
          const allZero = stateBytes.every((b) => b === 0);
          if (!allZero) {
            log("ok MPC callback received - encrypted state initialized");
            setResult({ pda: auctionPDA.toBase58(), sig: sig });
            setStatus("done");
            return;
          }
        }
        attempts++;
      }
      log("! timeout waiting for MPC callback - check explorer");
      setResult({ pda: auctionPDA.toBase58(), sig: sig });
      setStatus("done");
    } catch (e) {
      log("x error: " + (e?.message || String(e)));
      setStatus("error");
    }
  }

  return (
    <div>
      <Header />
      <main className="max-w-4xl mx-auto px-6 py-16">
        <Link href="/" className="mono text-xs uppercase tracking-wider text-[var(--dim)] hover:text-[var(--accent)] transition">
          back
        </Link>
        <div className="mono text-xs uppercase tracking-[0.2em] text-[var(--accent)] mt-8 mb-4">
          [01] Create
        </div>
        <h1 className="text-5xl font-bold tracking-tighter">
          New sealed-bid auction
        </h1>
        <p className="mt-4 text-[var(--dim)] max-w-xl">
          Configure your auction. Bids will be encrypted client-side and aggregated by MPC.
        </p>

        <div className="mt-12 grid md:grid-cols-2 gap-12">
          <div className="space-y-6">
            <Field label="Item name" sub="Free-text. Stored as auction metadata.">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Vintage watch"
                className="w-full bg-transparent border-b-2 border-[var(--line)] focus:border-[var(--accent)] outline-none py-3 text-lg transition"
              />
            </Field>
            <Field label="Minimum bid (SOL)" sub="Lowest bid the auction will accept.">
              <input
                type="number"
                step="any"
                min="0"
                value={minBid}
                onChange={(e) => setMinBid(e.target.value)}
                className="w-full bg-transparent border-b-2 border-[var(--line)] focus:border-[var(--accent)] outline-none py-3 text-lg mono transition"
              />
            </Field>
            <Field label="Duration (seconds)" sub="Auction stays open this long.">
              <input
                type="number"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                className="w-full bg-transparent border-b-2 border-[var(--line)] focus:border-[var(--accent)] outline-none py-3 text-lg mono transition"
              />
            </Field>
            <Field label="Auction type" sub="">
              <div className="grid grid-cols-2 gap-3 mt-2">
                <button
                  onClick={() => setAuctionType("firstPrice")}
                  className={"p-4 text-left border transition " + (auctionType === "firstPrice" ? "border-[var(--accent)] bg-[var(--accent)]/5" : "border-[var(--line)] hover:border-[var(--dim)]")}
                >
                  <div className="font-bold">First-price</div>
                  <div className="text-xs text-[var(--dim)] mt-1">winner pays own bid</div>
                </button>
                <button
                  onClick={() => setAuctionType("vickrey")}
                  className={"p-4 text-left border transition " + (auctionType === "vickrey" ? "border-[var(--accent)] bg-[var(--accent)]/5" : "border-[var(--line)] hover:border-[var(--dim)]")}
                >
                  <div className="font-bold">Vickrey</div>
                  <div className="text-xs text-[var(--dim)] mt-1">winner pays 2nd-highest</div>
                </button>
              </div>
            </Field>
            <button
              onClick={createAuction}
              disabled={!wallet || status === "signing" || status === "submitting" || status === "computing"}
              className="mono text-sm uppercase tracking-wider px-6 h-12 w-full bg-[var(--accent)] text-[var(--bg)] hover:bg-[var(--fg)] transition font-bold disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {!wallet ? "connect wallet to create" : status === "signing" ? "sign in wallet..." : status === "submitting" ? "submitting..." : status === "computing" ? "MPC computing..." : "create auction"}
            </button>
          </div>

          <div className="border border-[var(--line)] bg-black mono text-xs">
            <div className="border-b border-[var(--line)] px-4 py-2 flex items-center justify-between">
              <span className="text-[var(--dim)] uppercase tracking-wider">// console</span>
              <span className={"flex items-center gap-2 " + (status === "done" ? "text-[var(--accent)]" : status === "error" ? "text-red-400" : "text-[var(--dim)]")}>
                <span className="w-2 h-2 rounded-full bg-current" />
                {status}
              </span>
            </div>
            <div className="p-4 h-96 overflow-auto leading-relaxed">
              {logs.length === 0 ? (
                <div className="text-[var(--dim)]">awaiting command_</div>
              ) : (
                logs.map((l, i) => (
                  <div key={i} className={l.startsWith("ok") ? "text-[var(--accent)]" : l.startsWith("x") ? "text-red-400" : l.startsWith("!") ? "text-yellow-400" : "text-[var(--fg)]/80"}>
                    {l}
                  </div>
                ))
              )}
              {result && (
                <div className="mt-6 pt-4 border-t border-[var(--line)] space-y-2">
                  <div className="text-[var(--accent)]">AUCTION CREATED</div>
                  <div>pda: <span className="break-all">{result.pda}</span></div>
                  <div>
                    <a href={"https://explorer.solana.com/tx/" + result.sig + "?cluster=devnet"} target="_blank" rel="noreferrer" className="underline hover:text-[var(--accent)]">view on explorer</a>
                  </div>
                  <Link href={"/auction/" + result.pda} className="inline-block mt-3 px-4 py-2 bg-[var(--accent)] text-[var(--bg)] uppercase tracking-wider font-bold">
                    open auction
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function Field({ label, sub, children }) {
  return (
    <div>
      <div className="mono text-xs uppercase tracking-wider text-[var(--dim)]">{label}</div>
      {sub && <div className="mono text-[10px] text-[var(--dim)]/60 mt-0.5">{sub}</div>}
      <div className="mt-2">{children}</div>
    </div>
  );
}
