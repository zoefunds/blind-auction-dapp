"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
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
  getMXEPublicKey,
  RescueCipher,
  deserializeLE,
  x25519,
} from "@arcium-hq/client";
import idl from "@/lib/anchor/auction.json";
import Header from "@/components/Header";
import Link from "next/link";

const PROGRAM_ID = new PublicKey("C1L6yaUgu9rGbfbDzP61iyaqRrPrTJoUopMmjgLoVYzz");
const ARCIUM_CLUSTER_OFFSET = 456;

function splitPubkeyToU128s(pubkey) {
  const lo = deserializeLE(pubkey.slice(0, 16));
  const hi = deserializeLE(pubkey.slice(16, 32));
  return { lo, hi };
}

export default function AuctionDetail() {
  const params = useParams();
  const pda = params.pda;
  const { connection } = useConnection();
  const wallet = useAnchorWallet();

  const [auction, setAuction] = useState(null);
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));
  const [bidAmount, setBidAmount] = useState("500");
  const [depositAmount, setDepositAmount] = useState("1000");
  const [hasReceipt, setHasReceipt] = useState(false);
  const [receiptClaimed, setReceiptClaimed] = useState(false);
  const [status, setStatus] = useState("idle");
  const [logs, setLogs] = useState([]);
  const [resolved, setResolved] = useState(null);

  const log = (m) => setLogs((l) => [...l, m]);

  const refresh = useCallback(async () => {
    if (!pda) return;
    try {
      const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
      const program = new Program(idl, provider);
      const acc = await program.account.auction.fetch(new PublicKey(pda));
      setAuction(acc);
    } catch (e) {
      console.error(e);
    }
  }, [pda, connection, wallet]);

  useEffect(() => {
    refresh();
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
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
  }, [wallet, pda, connection, auction]);

  if (!pda) return null;

  async function placeBid() {
    if (!wallet || !auction) return;
    setStatus("encrypting");
    setLogs([]);
    try {
      const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
      const program = new Program(idl, provider);

      log("ok fetching MXE pubkey");
      const mxePubkey = await getMXEPublicKey(provider, PROGRAM_ID);

      log("ok generating x25519 keypair");
      const privateKey = x25519.utils.randomSecretKey();
      const publicKey = x25519.getPublicKey(privateKey);
      const sharedSecret = x25519.getSharedSecret(privateKey, mxePubkey);
      const cipher = new RescueCipher(sharedSecret);

      const { lo: bidderLo, hi: bidderHi } = splitPubkeyToU128s(wallet.publicKey.toBytes());
      const nonce = randomBytes(16);
      const plaintext = [bidderLo, bidderHi, BigInt(bidAmount)];
      const ciphertext = cipher.encrypt(plaintext, nonce);
      log("ok encrypted [bidder_lo, bidder_hi, amount=" + bidAmount + "]");

      const computationOffset = new BN(randomBytes(8), "hex");

      setStatus("signing");
      log("-> requesting signature");

      const [bidReceiptPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("receipt"), new PublicKey(pda).toBuffer(), wallet.publicKey.toBuffer()],
        PROGRAM_ID
      );

      const tx = await program.methods
        .placeBid(
          computationOffset,
          Array.from(ciphertext[0]),
          Array.from(ciphertext[1]),
          Array.from(ciphertext[2]),
          Array.from(publicKey),
          new BN(deserializeLE(nonce).toString()),
          new BN(depositAmount)
        )
        .accountsPartial({
          bidder: wallet.publicKey,
          auction: new PublicKey(pda),
          bidReceipt: bidReceiptPDA,
          computationAccount: getComputationAccAddress(ARCIUM_CLUSTER_OFFSET, computationOffset),
          clusterAccount: getClusterAccAddress(ARCIUM_CLUSTER_OFFSET),
          mxeAccount: getMXEAccAddress(PROGRAM_ID),
          mempoolAccount: getMempoolAccAddress(ARCIUM_CLUSTER_OFFSET),
          executingPool: getExecutingPoolAccAddress(ARCIUM_CLUSTER_OFFSET),
          compDefAccount: getCompDefAccAddress(
            PROGRAM_ID,
            Buffer.from(getCompDefAccOffset("place_bid")).readUInt32LE()
          ),
        })
        .transaction();

      tx.feePayer = wallet.publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
      const signed = await wallet.signTransaction(tx);

      setStatus("submitting");
      const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: true });
      log("ok bid tx: " + sig.slice(0, 24) + "...");
      await connection.confirmTransaction(sig, "confirmed");
      log("ok confirmed");

      setStatus("computing");
      log(".. Arx Nodes computing place_bid via MPC (~30-60s)");

      const startCount = auction.bidCount;
      let attempts = 0;
      while (attempts < 60) {
        await new Promise((r) => setTimeout(r, 2000));
        const acc = await program.account.auction.fetch(new PublicKey(pda));
        if (acc.bidCount > startCount) {
          log("ok bid recorded (count: " + acc.bidCount + ")");
          setAuction(acc);
          setStatus("done");
          return;
        }
        attempts++;
      }
      log("! timeout - bid may still be processing, refresh in a moment");
      setStatus("done");
    } catch (e) {
      log("x error: " + (e?.message || String(e)));
      setStatus("error");
    }
  }

  async function claimRefund() {
    if (!wallet || !auction) return;
    setStatus("submitting");
    setLogs([]);
    try {
      const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
      const program = new Program(idl, provider);
      const [receiptPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("receipt"), new PublicKey(pda).toBuffer(), wallet.publicKey.toBuffer()],
        PROGRAM_ID
      );

      const balBefore = await connection.getBalance(wallet.publicKey);
      log("ok bidder balance: " + (balBefore / 1e9).toFixed(6) + " SOL");

      log("-> claiming refund");
      const tx = await program.methods
        .claimRefund()
        .accountsPartial({
          bidder: wallet.publicKey,
          auction: new PublicKey(pda),
          bidReceipt: receiptPDA,
        })
        .transaction();
      tx.feePayer = wallet.publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
      const signed = await wallet.signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: true });
      await connection.confirmTransaction(sig, "confirmed");
      log("ok claim tx: " + sig.slice(0, 24));

      const balAfter = await connection.getBalance(wallet.publicKey);
      log("ok new balance: " + (balAfter / 1e9).toFixed(6) + " SOL");
      setReceiptClaimed(true);
      setStatus("done");
    } catch (e) {
      log("x error: " + (e?.message || String(e)));
      setStatus("error");
    }
  }

  async function closeAuction() {
    if (!wallet || !auction) return;
    setStatus("submitting");
    setLogs([]);
    try {
      const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
      const program = new Program(idl, provider);
      log("-> closing auction");
      const tx = await program.methods
        .closeAuction()
        .accountsPartial({
          authority: wallet.publicKey,
          auction: new PublicKey(pda),
        })
        .transaction();
      tx.feePayer = wallet.publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
      const signed = await wallet.signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: true });
      await connection.confirmTransaction(sig, "confirmed");
      log("ok closed: " + sig.slice(0, 24));
      await refresh();
      setStatus("done");
    } catch (e) {
      log("x error: " + (e?.message || String(e)));
      setStatus("error");
    }
  }

  async function revealWinner() {
    if (!wallet || !auction) return;
    setLogs([]);
    if (auction.bidCount === 0) {
      setStatus("error");
      setLogs(["x cannot reveal: no bids were placed", "  this auction had 0 bidders. nothing to reveal."]);
      return;
    }
    setStatus("computing");
    try {
      const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
      const program = new Program(idl, provider);
      const isFirstPrice = auction.auctionType.firstPrice !== undefined;
      const circuitName = isFirstPrice ? "determine_winner_first_price" : "determine_winner_vickrey";
      const computationOffset = new BN(randomBytes(8), "hex");
      const method = isFirstPrice
        ? program.methods.determineWinnerFirstPrice(computationOffset)
        : program.methods.determineWinnerVickrey(computationOffset);

      log("-> queueing " + circuitName + " MPC computation");
      const tx = await method
        .accountsPartial({
          authority: wallet.publicKey,
          auction: new PublicKey(pda),
          computationAccount: getComputationAccAddress(ARCIUM_CLUSTER_OFFSET, computationOffset),
          clusterAccount: getClusterAccAddress(ARCIUM_CLUSTER_OFFSET),
          mxeAccount: getMXEAccAddress(PROGRAM_ID),
          mempoolAccount: getMempoolAccAddress(ARCIUM_CLUSTER_OFFSET),
          executingPool: getExecutingPoolAccAddress(ARCIUM_CLUSTER_OFFSET),
          compDefAccount: getCompDefAccAddress(
            PROGRAM_ID,
            Buffer.from(getCompDefAccOffset(circuitName)).readUInt32LE()
          ),
        })
        .transaction();
      tx.feePayer = wallet.publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
      const signed = await wallet.signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: true });
      log("ok reveal tx: " + sig.slice(0, 24));
      await connection.confirmTransaction(sig, "confirmed");

      log(".. Arx Nodes revealing winner via MPC (~30-60s)");

      // Listen for AuctionResolvedEvent
      let listenerId;
      const eventPromise = new Promise((res, rej) => {
        const timeout = setTimeout(() => {
          program.removeEventListener(listenerId);
          rej(new Error("reveal timeout (120s)"));
        }, 120000);
        listenerId = program.addEventListener("auctionResolvedEvent", (event) => {
          if (event.auction && event.auction.toBase58() === pda) {
            clearTimeout(timeout);
            res(event);
          }
        });
      });

      const resolvedEvent = await eventPromise;
      await program.removeEventListener(listenerId);

      const winnerHex = Buffer.from(resolvedEvent.winner).toString("hex");
      const payment = resolvedEvent.paymentAmount.toString();
      log("ok winner: " + winnerHex.slice(0, 16) + "...");
      log("ok payment: " + payment +  " lamports");
      setResolved({ winner: winnerHex, payment });
      await refresh();
      setStatus("done");
    } catch (e) {
      log("x error: " + (e?.message || String(e)));
      setStatus("error");
    }
  }

  const endTime = auction ? auction.endTime.toNumber() : 0;
  const remaining = Math.max(0, endTime - now);
  const isOpen = auction?.status?.open !== undefined;
  const isClosed = auction?.status?.closed !== undefined;
  const isResolved = auction?.status?.resolved !== undefined;
  const isAuthority = wallet && auction && wallet.publicKey.toBase58() === auction.authority.toBase58();
  const canBid = isOpen && remaining > 0 && wallet && !isAuthority;
  const canClose = isOpen && remaining === 0 && isAuthority;
  const canReveal = isClosed && isAuthority;
  const isFirstPrice = auction?.auctionType?.firstPrice !== undefined;

  return (
    <div>
      <Header />
      <main className="max-w-6xl mx-auto px-6 py-12">
        <Link href="/" className="mono text-xs uppercase tracking-wider text-[var(--dim)] hover:text-[var(--accent)] transition">
          back
        </Link>

        <div className="mt-8 grid md:grid-cols-3 gap-12">
          {/* LEFT: AUCTION INFO */}
          <div className="md:col-span-2">
            <div className="mono text-xs uppercase tracking-[0.2em] text-[var(--accent)] mb-4">
              [AUCTION] {pda.slice(0, 8)}...{pda.slice(-4)}
            </div>
            <h1 className="text-5xl font-bold tracking-tighter">
              {isOpen ? "Open for bids" : isClosed ? "Closed - awaiting reveal" : "Resolved"}
            </h1>

            {auction ? (
              <div className="mt-12 mono text-sm space-y-3">
                <Row k="status" v={isOpen ? "OPEN" : isClosed ? "CLOSED" : "RESOLVED"} accent={isOpen} />
                <Row k="type" v={isFirstPrice ? "first-price" : "vickrey (2nd-price)"} />
                <Row k="authority" v={auction.authority.toBase58()} />
                <Row k="min bid" v={auction.minBid.toString() +  " lamports"} />
                <Row k="bids placed" v={String(auction.bidCount)} />
                <Row k="ends at" v={new Date(endTime * 1000).toLocaleString()} />
                {isOpen && remaining > 0 && (
                  <Row k="time left" v={formatTime(remaining)} accent />
                )}
                <Row k="encrypted state" v={Buffer.from(auction.encryptedState[0]).toString("hex").slice(0, 32) + "..."} mono />
              </div>
            ) : (
              <div className="mt-12 text-[var(--dim)] mono text-sm">loading auction state...</div>
            )}

            {/* RESOLVED RESULT */}
            {(resolved || isResolved) && (
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
            )}
          </div>

          {/* RIGHT: ACTIONS + CONSOLE */}
          <div className="space-y-6">
            {/* PLACE BID */}
            {canBid && !hasReceipt && (
              <div className="border border-[var(--line)] p-6">
                <div className="mono text-xs uppercase tracking-wider text-[var(--dim)] mb-4">
                  place sealed bid
                </div>
                <div className="mono text-[10px] uppercase text-[var(--dim)] mb-1">bid amount (encrypted)</div>
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
                />
                <button
                  onClick={placeBid}
                  disabled={status !== "idle" && status !== "done" && status !== "error"}
                  className="mt-4 mono text-sm uppercase tracking-wider px-6 h-12 w-full bg-[var(--accent)] text-[var(--bg)] hover:bg-[var(--fg)] transition font-bold disabled:opacity-30"
                >
                  {status === "idle" || status === "done" || status === "error" ? "encrypt + bid" : status + "..."}
                </button>
                <div className="mt-3 mono text-[10px] text-[var(--dim)] leading-relaxed">
                  your bid is encrypted; deposit is escrowed in plaintext. losers reclaim deposit; winners reclaim deposit minus winning bid.
                </div>
              </div>
            )}

            {hasReceipt && !receiptClaimed && isResolved && (
              <div className="border border-[var(--accent)] p-6">
                <div className="mono text-xs uppercase tracking-wider text-[var(--accent)] mb-2">refund available</div>
                <div className="text-sm text-[var(--dim)] mb-4">
                  auction is resolved. claim your deposit refund.
                </div>
                <button
                  onClick={claimRefund}
                  disabled={status === "submitting"}
                  className="mono text-sm uppercase tracking-wider px-6 h-12 w-full bg-[var(--accent)] text-[var(--bg)] hover:bg-[var(--fg)] transition font-bold disabled:opacity-30"
                >
                  {status === "submitting" ? "claiming..." : "claim refund"}
                </button>
              </div>
            )}

            {hasReceipt && receiptClaimed && (
              <div className="border border-[var(--line)] p-6 text-sm text-[var(--dim)]">
                ✓ you already claimed your refund for this auction.
              </div>
            )}

            {hasReceipt && !isResolved && (
              <div className="border border-[var(--line)] p-6 text-sm text-[var(--dim)]">
                you bid on this auction. deposit escrowed. claim refund after reveal.
              </div>
            )}

            {isAuthority && isOpen && (
              <div className="border border-[var(--line)] p-6">
                <div className="mono text-xs uppercase tracking-wider text-[var(--dim)] mb-2">authority</div>
                <div className="text-sm mb-4">
                  {remaining > 0
                    ? "wait for auction to end before closing"
                    : "auction ended - close to reveal winner"}
                </div>
                <button
                  onClick={closeAuction}
                  disabled={!canClose || status !== "idle" && status !== "done" && status !== "error"}
                  className="mono text-sm uppercase tracking-wider px-6 h-12 w-full border border-[var(--line)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition disabled:opacity-30"
                >
                  close auction
                </button>
              </div>
            )}

            {isAuthority && isClosed && auction && auction.bidCount === 0 && (
              <div className="border border-[var(--line)] p-6 text-sm text-[var(--dim)]">
                no bids were placed. nothing to reveal.
              </div>
            )}
            {isAuthority && isClosed && auction && auction.bidCount > 0 && (
              <div className="border border-[var(--line)] p-6">
                <div className="mono text-xs uppercase tracking-wider text-[var(--accent)] mb-2">ready to reveal</div>
                <button
                  onClick={revealWinner}
                  disabled={!canReveal || status !== "idle" && status !== "done" && status !== "error"}
                  className="mono text-sm uppercase tracking-wider px-6 h-12 w-full bg-[var(--accent)] text-[var(--bg)] hover:bg-[var(--fg)] transition font-bold disabled:opacity-30"
                >
                  {status === "computing" ? "MPC computing..." : "reveal winner"}
                </button>
              </div>
            )}

            {!wallet && (
              <div className="border border-[var(--line)] p-6 text-sm text-[var(--dim)]">
                connect wallet to interact
              </div>
            )}

            {isAuthority && isOpen && remaining > 0 && (
              <div className="text-xs text-[var(--dim)] mono">
                you created this auction. you cannot bid on it.
              </div>
            )}

            {/* CONSOLE */}
            <div className="border border-[var(--line)] bg-black mono text-xs">
              <div className="border-b border-[var(--line)] px-4 py-2 flex items-center justify-between">
                <span className="text-[var(--dim)] uppercase tracking-wider">// console</span>
                <span className={"flex items-center gap-2 " + (status === "done" ? "text-[var(--accent)]" : status === "error" ? "text-red-400" : "text-[var(--dim)]")}>
                  <span className="w-2 h-2 rounded-full bg-current" />
                  {status}
                </span>
              </div>
              <div className="p-4 h-64 overflow-auto leading-relaxed">
                {logs.length === 0 ? (
                  <div className="text-[var(--dim)]">awaiting command_</div>
                ) : (
                  logs.map((l, i) => (
                    <div key={i} className={l.startsWith("ok") ? "text-[var(--accent)]" : l.startsWith("x") ? "text-red-400" : l.startsWith("!") ? "text-yellow-400" : "text-[var(--fg)]/80"}>
                      {l}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function Row({ k, v, accent, mono: monoVal }) {
  return (
    <div className="flex items-baseline gap-6 py-2 border-b border-[var(--line)]">
      <div className="text-[var(--dim)] uppercase text-[10px] tracking-wider w-28 shrink-0">{k}</div>
      <div className={(accent ? "text-[var(--accent)] " : "") + (monoVal ? "break-all " : "") + "break-all"}>{v}</div>
    </div>
  );
}

function formatTime(s) {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m + "m " + r + "s";
}
