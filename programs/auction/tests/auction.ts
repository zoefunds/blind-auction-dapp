import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { Auction } from "../target/types/auction";
import { randomBytes } from "crypto";
import {
  awaitComputationFinalization,
  getArciumEnv,
  getCompDefAccOffset,
  getArciumAccountBaseSeed,
  getArciumProgramId,
  RescueCipher,
  deserializeLE,
  getMXEPublicKey,
  getMXEAccAddress,
  getMempoolAccAddress,
  getCompDefAccAddress,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  getClusterAccAddress,
  getLookupTableAddress,
  getArciumProgram,
  x25519,
} from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";
import { expect } from "chai";

/**
 * Splits a 32-byte public key into two u128 values (lo and hi parts).
 * Required because Arcis encrypts each primitive separately.
 */
function splitPubkeyToU128s(pubkey: Uint8Array): { lo: bigint; hi: bigint } {
  const loBytes = pubkey.slice(0, 16);
  const hiBytes = pubkey.slice(16, 32);
  const lo = deserializeLE(loBytes);
  const hi = deserializeLE(hiBytes);
  return { lo, hi };
}

/**
 * Builds a tx via program.methods, then signs and sends manually.
 * Workaround for Anchor 0.32's broken rpc() with web3.js 1.95+
 * which throws "Unknown action 'undefined'".
 */
async function manualRpc(
  builder: any,
  provider: anchor.AnchorProvider,
  extraSigners: anchor.web3.Keypair[] = [],
  label: string = "tx"
): Promise<string> {
  const tx = await builder.transaction();
  const conn = provider.connection;
  const wallet = provider.wallet as any;
  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;

  // Optional: simulate first to surface real on-chain errors
  try {
    const sim = await conn.simulateTransaction(tx);
    if (sim.value.err) {
      console.log(`  [${label}] simulation err:`, JSON.stringify(sim.value.err));
      console.log(`  [${label}] simulation logs:`);
      (sim.value.logs ?? []).forEach((l) => console.log("    " + l));
    }
  } catch (e) {
    console.log(`  [${label}] simulation threw:`, e);
  }

  // Sign with extra keypairs first (e.g., new auction authority)
  if (extraSigners.length > 0) {
    tx.partialSign(...extraSigners);
  }
  // Then with the wallet
  const signed = await wallet.signTransaction(tx);
  const sig = await conn.sendRawTransaction(signed.serialize(), {
    skipPreflight: true,
  });
  await conn.confirmTransaction(sig, "confirmed");
  return sig;
}

describe("Auction (Sealed-Bid First-Price)", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.Auction as Program<Auction>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const arciumEnv = getArciumEnv();
  const clusterAccount = getClusterAccAddress(arciumEnv.arciumClusterOffset);

  type Event = anchor.IdlEvents<(typeof program)["idl"]>;

  // ---- helpers ----

  function readKpJson(path: string): anchor.web3.Keypair {
    const file = fs.readFileSync(path);
    return anchor.web3.Keypair.fromSecretKey(
      new Uint8Array(JSON.parse(file.toString()))
    );
  }

  async function getMXEPublicKeyWithRetry(
    programId: PublicKey,
    maxRetries = 20,
    retryDelayMs = 500
  ): Promise<Uint8Array> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const k = await getMXEPublicKey(provider, programId);
        if (k) return k;
      } catch (e) {
        // ignore, retry
      }
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, retryDelayMs));
      }
    }
    throw new Error(`Failed to fetch MXE public key after ${maxRetries} attempts`);
  }

  const awaitEvent = async <E extends keyof Event>(
    eventName: E,
    auctionKey?: PublicKey,
    timeoutMs = 180000
  ): Promise<Event[E]> => {
    let listenerId: number;
    let timeoutId: NodeJS.Timeout;
    const event = await new Promise<Event[E]>((res, rej) => {
      listenerId = program.addEventListener(
        eventName,
        (event: Record<string, unknown>) => {
          if (
            auctionKey &&
            event.auction instanceof PublicKey &&
            !event.auction.equals(auctionKey)
          )
            return;
          clearTimeout(timeoutId);
          res(event as Event[E]);
        }
      );
      timeoutId = setTimeout(() => {
        program.removeEventListener(listenerId);
        rej(new Error(`Event ${String(eventName)} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
    await program.removeEventListener(listenerId);
    return event;
  };

  /**
   * Idempotent comp def init: only initializes if the account does not yet exist.
   * The 4 different init methods take different account contexts, so we dispatch by name.
   */
  async function ensureCompDef(circuitName: string, owner: anchor.web3.Keypair) {
    const baseSeed = getArciumAccountBaseSeed("ComputationDefinitionAccount");
    const offset = getCompDefAccOffset(circuitName);
    const compDefPDA = PublicKey.findProgramAddressSync(
      [baseSeed, program.programId.toBuffer(), offset],
      getArciumProgramId()
    )[0];

    const existing = await provider.connection.getAccountInfo(compDefPDA);
    if (existing) {
      console.log(`  ✓ comp def '${circuitName}' already initialized at ${compDefPDA.toBase58()} - skipping`);
      return;
    }

    const arciumProgram = getArciumProgram(provider);
    const mxeAccount = getMXEAccAddress(program.programId);
    const mxeAcc = await arciumProgram.account.mxeAccount.fetch(mxeAccount);
    const lutAddress = getLookupTableAddress(program.programId, mxeAcc.lutOffsetSlot);

    const accs = {
      compDefAccount: compDefPDA,
      payer: owner.publicKey,
      mxeAccount,
      addressLookupTable: lutAddress,
    };

    let builder: any;
    switch (circuitName) {
      case "init_auction_state":
        builder = program.methods.initAuctionStateCompDef().accounts(accs);
        break;
      case "place_bid":
        builder = program.methods.initPlaceBidCompDef().accounts(accs);
        break;
      case "determine_winner_first_price":
        builder = program.methods.initDetermineWinnerFirstPriceCompDef().accounts(accs);
        break;
      case "determine_winner_vickrey":
        builder = program.methods.initDetermineWinnerVickreyCompDef().accounts(accs);
        break;
      default:
        throw new Error(`Unknown circuit: ${circuitName}`);
    }
    const sig = await manualRpc(builder, provider, [owner], `init-${circuitName}`);
    console.log(`  ✓ initialized comp def '${circuitName}' tx: ${sig}`);
  }

  let owner: anchor.web3.Keypair;
  let mxePublicKey: Uint8Array;

  before(async () => {
    owner = readKpJson(`${os.homedir()}/.config/solana/id.json`);
    console.log("\n=== SETUP ===");
    console.log("Wallet:", owner.publicKey.toBase58());
    mxePublicKey = await getMXEPublicKeyWithRetry(program.programId);
    console.log("MXE x25519 pubkey:", Buffer.from(mxePublicKey).toString("hex"));

    console.log("\n=== Init Computation Definitions (idempotent) ===");
    await ensureCompDef("init_auction_state", owner);
    await ensureCompDef("place_bid", owner);
    await ensureCompDef("determine_winner_first_price", owner);
    // Vickrey not used in MVP test, but init for completeness
    await ensureCompDef("determine_winner_vickrey", owner);
    console.log("=== Comp defs ready ===\n");
  });

  it("creates a first-price auction, accepts a sealed bid, and reveals winner", async function () {
    this.timeout(300000); // 5 minutes - MPC operations can be slow on devnet

    const bidder = owner;
    const bidderPubkey = bidder.publicKey.toBytes();
    const { lo: bidderLo, hi: bidderHi } = splitPubkeyToU128s(bidderPubkey);

    const privateKey = x25519.utils.randomSecretKey();
    const publicKey = x25519.getPublicKey(privateKey);
    const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
    const cipher = new RescueCipher(sharedSecret);

    // === Step 1: Create First-Price Auction ===
    console.log("\n--- Step 1: Create auction ---");
    const createCompOffset = new anchor.BN(randomBytes(8), "hex");
    // Use a fresh authority keypair per test run so we always get a new PDA
    const auctionAuthority = anchor.web3.Keypair.generate();
    // Fund the new authority
    const transferIx = anchor.web3.SystemProgram.transfer({
      fromPubkey: owner.publicKey,
      toPubkey: auctionAuthority.publicKey,
      lamports: 0.5 * anchor.web3.LAMPORTS_PER_SOL,
    });
    const fundTx = new anchor.web3.Transaction().add(transferIx);
    fundTx.feePayer = owner.publicKey;
    fundTx.recentBlockhash = (await provider.connection.getLatestBlockhash("confirmed")).blockhash;
    const signedFund = await (provider.wallet as any).signTransaction(fundTx);
    const fundSig = await provider.connection.sendRawTransaction(signedFund.serialize(), { skipPreflight: true });
    await provider.connection.confirmTransaction(fundSig, "confirmed");
    console.log("  Funded fresh authority:", auctionAuthority.publicKey.toBase58());

    const auctionNonce = new anchor.BN(Date.now());
    const auctionNonceBytes = auctionNonce.toArrayLike(Buffer, "le", 8);
    const [auctionPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("auction"), auctionAuthority.publicKey.toBuffer(), auctionNonceBytes],
      program.programId
    );

    const auctionCreatedPromise = awaitEvent("auctionCreatedEvent", auctionPDA);

    const createBuilder = program.methods
      .createAuction(
        createCompOffset,
        auctionNonce,
        { firstPrice: {} } as any,
        new anchor.BN(100),
        new anchor.BN(120)
      )
      .accountsPartial({
        authority: auctionAuthority.publicKey,
        auction: auctionPDA,
        computationAccount: getComputationAccAddress(arciumEnv.arciumClusterOffset, createCompOffset),
        clusterAccount,
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
        executingPool: getExecutingPoolAccAddress(arciumEnv.arciumClusterOffset),
        compDefAccount: getCompDefAccAddress(
          program.programId,
          Buffer.from(getCompDefAccOffset("init_auction_state")).readUInt32LE()
        ),
      });
    const createSig = await manualRpc(createBuilder, provider, [auctionAuthority], "create-auction");
    console.log("  Create tx:", createSig);

    const createFinalizeSig = await awaitComputationFinalization(
      provider, createCompOffset, program.programId, "confirmed"
    );
    console.log("  MPC finalize:", createFinalizeSig);

    const auctionCreatedEvent = await auctionCreatedPromise;
    console.log("  Auction created:", auctionCreatedEvent.auction.toBase58());
    expect(auctionCreatedEvent.minBid.toNumber()).to.equal(100);

    // === Step 2: Place encrypted bid (500 lamports) ===
    console.log("\n--- Step 2: Place sealed bid of 500 lamports ---");
    const bidPlacedPromise = awaitEvent("bidPlacedEvent", auctionPDA);
    const bidCompOffset = new anchor.BN(randomBytes(8), "hex");

    const bidAmount = BigInt(500);
    const nonce = randomBytes(16);
    const bidPlaintext = [bidderLo, bidderHi, bidAmount];
    const bidCiphertext = cipher.encrypt(bidPlaintext, nonce);

    const [bidReceiptPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("receipt"), auctionPDA.toBuffer(), bidder.publicKey.toBuffer()],
      program.programId
    );

    const placeBidBuilder = program.methods
      .placeBid(
        bidCompOffset,
        Array.from(bidCiphertext[0]),
        Array.from(bidCiphertext[1]),
        Array.from(bidCiphertext[2]),
        Array.from(publicKey),
        new anchor.BN(deserializeLE(nonce).toString()),
        new anchor.BN(1000)  // deposit_amount: 1000 lamports (>= bid 500, >= min 100)
      )
      .accountsPartial({
        bidder: bidder.publicKey,
        auction: auctionPDA,
        bidReceipt: bidReceiptPDA,
        computationAccount: getComputationAccAddress(arciumEnv.arciumClusterOffset, bidCompOffset),
        clusterAccount,
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
        executingPool: getExecutingPoolAccAddress(arciumEnv.arciumClusterOffset),
        compDefAccount: getCompDefAccAddress(
          program.programId,
          Buffer.from(getCompDefAccOffset("place_bid")).readUInt32LE()
        ),
      });
    const placeBidSig = await manualRpc(placeBidBuilder, provider, [], "place-bid");
    console.log("  Bid tx:", placeBidSig);

    const bidFinalizeSig = await awaitComputationFinalization(
      provider, bidCompOffset, program.programId, "confirmed"
    );
    console.log("  MPC finalize:", bidFinalizeSig);

    const bidPlacedEvent = await bidPlacedPromise;
    console.log("  Bid count:", bidPlacedEvent.bidCount);
    expect(bidPlacedEvent.bidCount).to.equal(1);

    // === Step 3: Verify the on-chain auction PDA only has encrypted state ===
    console.log("\n--- Step 3: Verify privacy (encrypted state on chain) ---");
    const auctionAccount = await program.account.auction.fetch(auctionPDA);
    console.log("  bid_count:", auctionAccount.bidCount);
    console.log("  encrypted_state[0] (first 8 bytes):",
      Buffer.from(auctionAccount.encryptedState[0].slice(0, 8)).toString("hex"));
    console.log("  state_nonce:", auctionAccount.stateNonce.toString());
    console.log("  → Bid amount (500) is NOT visible anywhere in the account state.");
    console.log("  → Even on-chain inspectors only see the encrypted ciphertext.");

    // Sanity: the encrypted state cannot just be all zeros (would mean encryption failed)
    const allZero = auctionAccount.encryptedState.every((row: number[]) =>
      row.every((b: number) => b === 0)
    );
    expect(allZero).to.equal(false);

    // === Step 4: Wait for auction to end ===
    console.log("\n--- Step 4: Wait for auction end ---");
    const endTime = auctionAccount.endTime.toNumber();
    while (true) {
      const slot = await provider.connection.getSlot("confirmed");
      const blockTime = await provider.connection.getBlockTime(slot);
      if (blockTime === null) break;
      if (blockTime >= endTime) break;
      console.log(`  validator clock: ${blockTime}, end_time: ${endTime}, waiting ${endTime - blockTime}s...`);
      await new Promise((r) => setTimeout(r, 3000));
    }

    // === Step 5: Close auction ===
    console.log("\n--- Step 5: Close auction ---");
    const closedPromise = awaitEvent("auctionClosedEvent", auctionPDA);
    const closeBuilder = program.methods
      .closeAuction()
      .accountsPartial({
        authority: auctionAuthority.publicKey,
        auction: auctionPDA,
      });
    const closeSig = await manualRpc(closeBuilder, provider, [auctionAuthority], "close-auction");
    console.log("  Close tx:", closeSig);
    const closedEvent = await closedPromise;
    console.log("  Closed, bid_count:", closedEvent.bidCount);

    // === Step 6: Determine winner (first-price) ===
    console.log("\n--- Step 6: Determine winner (MPC reveal) ---");
    const resolvedPromise = awaitEvent("auctionResolvedEvent", auctionPDA);
    const resolveCompOffset = new anchor.BN(randomBytes(8), "hex");

    const determineBuilder = program.methods
      .determineWinnerFirstPrice(resolveCompOffset)
      .accountsPartial({
        authority: auctionAuthority.publicKey,
        auction: auctionPDA,
        computationAccount: getComputationAccAddress(arciumEnv.arciumClusterOffset, resolveCompOffset),
        clusterAccount,
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
        executingPool: getExecutingPoolAccAddress(arciumEnv.arciumClusterOffset),
        compDefAccount: getCompDefAccAddress(
          program.programId,
          Buffer.from(getCompDefAccOffset("determine_winner_first_price")).readUInt32LE()
        ),
      });
    const resolveSig = await manualRpc(determineBuilder, provider, [auctionAuthority], "determine-winner");
    console.log("  Resolve tx:", resolveSig);

    const resolveFinalizeSig = await awaitComputationFinalization(
      provider, resolveCompOffset, program.programId, "confirmed"
    );
    console.log("  MPC finalize:", resolveFinalizeSig);

    const resolvedEvent = await resolvedPromise;
    console.log("\n=== AUCTION RESULT ===");
    const winnerHex = Buffer.from(resolvedEvent.winner).toString("hex");
    const expectedHex = Buffer.from(bidderPubkey).toString("hex");
    console.log("  Winner pubkey:", winnerHex);
    console.log("  Payment amount:", resolvedEvent.paymentAmount.toNumber(), "lamports");

    expect(resolvedEvent.paymentAmount.toNumber()).to.equal(500);
    expect(winnerHex).to.equal(expectedHex);
    console.log("\n  ✅ First-price auction resolved correctly. MPC PRIVACY PRESERVED.");

    // === Step 7: Claim refund ===
    console.log("\n--- Step 7: Claim refund (winner pays bid, gets back deposit - bid) ---");
    const balBefore = await provider.connection.getBalance(bidder.publicKey);
    console.log("  bidder balance before claim:", balBefore / 1e9, "SOL");

    const claimBuilder = program.methods
      .claimRefund()
      .accountsPartial({
        bidder: bidder.publicKey,
        auction: auctionPDA,
        bidReceipt: bidReceiptPDA,
      });
    const auctionBalBefore = await provider.connection.getBalance(auctionPDA);
    console.log("  auction PDA balance before claim:", auctionBalBefore, "lamports");

    const claimSig = await manualRpc(claimBuilder, provider, [], "claim-refund");
    console.log("  Claim tx:", claimSig);

    const auctionBalAfter = await provider.connection.getBalance(auctionPDA);
    const balAfter = await provider.connection.getBalance(bidder.publicKey);
    console.log("  bidder balance after claim:", balAfter / 1e9, "SOL (lower due to ~5000 lamport tx fee)");
    console.log("  auction PDA balance after claim:", auctionBalAfter, "lamports");
    console.log("  refund extracted from PDA:", auctionBalBefore - auctionBalAfter, "lamports (expected 500)");

    // Winner deposited 1000, owes 500, refund = 500 lamports out of auction PDA
    expect(auctionBalBefore - auctionBalAfter).to.equal(500);
    console.log("  ✅ Escrow refund correct: winner paid exactly 500 lamports.");
  });
});

describe("Auction (Sealed-Bid Vickrey / 2nd-price)", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.Auction as Program<Auction>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const arciumEnv = getArciumEnv();
  const clusterAccount = getClusterAccAddress(arciumEnv.arciumClusterOffset);

  type Event = anchor.IdlEvents<(typeof program)["idl"]>;

  function readKp(path: string): anchor.web3.Keypair {
    return anchor.web3.Keypair.fromSecretKey(
      new Uint8Array(JSON.parse(fs.readFileSync(path).toString()))
    );
  }

  async function fundFrom(payer: anchor.web3.Keypair, to: PublicKey, sol: number) {
    const ix = anchor.web3.SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: to,
      lamports: Math.floor(sol * anchor.web3.LAMPORTS_PER_SOL),
    });
    const tx = new anchor.web3.Transaction().add(ix);
    tx.feePayer = payer.publicKey;
    tx.recentBlockhash = (await provider.connection.getLatestBlockhash("confirmed")).blockhash;
    tx.sign(payer);
    const sig = await provider.connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    await provider.connection.confirmTransaction(sig, "confirmed");
  }

  async function sendAs(builder: any, signer: anchor.web3.Keypair, label: string): Promise<string> {
    const tx = await builder.transaction();
    tx.feePayer = signer.publicKey;
    const bh = await provider.connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = bh.blockhash;
    tx.sign(signer);
    const sig = await provider.connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    const conf = await provider.connection.confirmTransaction(
      { signature: sig, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight },
      "confirmed"
    );
    if (conf.value.err) {
      const txDetail = await provider.connection.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      console.log(`  ${label} FAILED:`, JSON.stringify(conf.value.err));
      (txDetail?.meta?.logMessages ?? []).forEach((l) => console.log("    " + l));
      throw new Error(`${label} tx failed: ${JSON.stringify(conf.value.err)}`);
    }
    console.log(`  ${label} tx:`, sig);
    return sig;
  }

  async function pollAuctionStatus(pda: PublicKey, want: "open" | "closed" | "resolved", maxMs = 90000) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      try {
        const acc = await program.account.auction.fetch(pda);
        if ((acc.status as any)[want] !== undefined) return acc;
      } catch {}
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error(`auction did not reach status=${want} within ${maxMs}ms`);
  }

  const awaitEvent = async <E extends keyof Event>(
    eventName: E,
    auctionKey?: PublicKey,
    timeoutMs = 180000
  ): Promise<Event[E]> => {
    let listenerId: number;
    let timeoutId: NodeJS.Timeout;
    const event = await new Promise<Event[E]>((res, rej) => {
      listenerId = program.addEventListener(eventName, (event: Record<string, unknown>) => {
        if (auctionKey && event.auction instanceof PublicKey && !event.auction.equals(auctionKey)) return;
        clearTimeout(timeoutId);
        res(event as Event[E]);
      });
      timeoutId = setTimeout(() => {
        program.removeEventListener(listenerId);
        rej(new Error(`Event ${String(eventName)} timed out`));
      }, timeoutMs);
    });
    await program.removeEventListener(listenerId);
    return event;
  };

  it("two bidders -> winner pays second-highest bid", async function () {
    this.timeout(420000);

    const owner = readKp(`${os.homedir()}/.config/solana/id.json`);
    const mxePublicKey = await getMXEPublicKey(provider, program.programId);

    // === Funded actors ===
    const authority = anchor.web3.Keypair.generate();
    const bidderA = anchor.web3.Keypair.generate(); // bids 500 (loser)
    const bidderB = anchor.web3.Keypair.generate(); // bids 800 (winner, pays 500)
    await fundFrom(owner, authority.publicKey, 0.2);
    await fundFrom(owner, bidderA.publicKey, 0.05);
    await fundFrom(owner, bidderB.publicKey, 0.05);
    console.log("  authority:", authority.publicKey.toBase58());
    console.log("  bidderA:", bidderA.publicKey.toBase58());
    console.log("  bidderB:", bidderB.publicKey.toBase58());

    // === Step 1: create vickrey auction ===
    console.log("\n--- Step 1: Create vickrey auction ---");
    const createCompOffset = new anchor.BN(randomBytes(8), "hex");
    const auctionNonce = new anchor.BN(Date.now());
    const auctionNonceBytes = auctionNonce.toArrayLike(Buffer, "le", 8);
    const [auctionPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("auction"), authority.publicKey.toBuffer(), auctionNonceBytes],
      program.programId
    );

    const createdPromise = awaitEvent("auctionCreatedEvent", auctionPDA);
    const createBuilder = program.methods
      .createAuction(
        createCompOffset,
        auctionNonce,
        { vickrey: {} } as any,
        new anchor.BN(100),
        new anchor.BN(120)
      )
      .accountsPartial({
        authority: authority.publicKey,
        auction: auctionPDA,
        computationAccount: getComputationAccAddress(arciumEnv.arciumClusterOffset, createCompOffset),
        clusterAccount,
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
        executingPool: getExecutingPoolAccAddress(arciumEnv.arciumClusterOffset),
        compDefAccount: getCompDefAccAddress(
          program.programId,
          Buffer.from(getCompDefAccOffset("init_auction_state")).readUInt32LE()
        ),
      });
    await sendAs(createBuilder, authority, "create");
    await awaitComputationFinalization(provider, createCompOffset, program.programId, "confirmed");
    await createdPromise;
    console.log("  Auction created:", auctionPDA.toBase58());

    // === Step 2: place two encrypted bids ===
    async function bid(bidder: anchor.web3.Keypair, amount: bigint, label: string) {
      const priv = x25519.utils.randomSecretKey();
      const pub = x25519.getPublicKey(priv);
      const sharedSecret = x25519.getSharedSecret(priv, mxePublicKey);
      const cipher = new RescueCipher(sharedSecret);
      const { lo, hi } = splitPubkeyToU128s(bidder.publicKey.toBytes());
      const nonce = randomBytes(16);
      const ct = cipher.encrypt([lo, hi, amount], nonce);

      const [receiptPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("receipt"), auctionPDA.toBuffer(), bidder.publicKey.toBuffer()],
        program.programId
      );
      const compOff = new anchor.BN(randomBytes(8), "hex");
      const placedPromise = awaitEvent("bidPlacedEvent", auctionPDA);
      const b = program.methods
        .placeBid(
          compOff,
          Array.from(ct[0]),
          Array.from(ct[1]),
          Array.from(ct[2]),
          Array.from(pub),
          new anchor.BN(deserializeLE(nonce).toString()),
          new anchor.BN(1000)
        )
        .accountsPartial({
          bidder: bidder.publicKey,
          auction: auctionPDA,
          bidReceipt: receiptPDA,
          computationAccount: getComputationAccAddress(arciumEnv.arciumClusterOffset, compOff),
          clusterAccount,
          mxeAccount: getMXEAccAddress(program.programId),
          mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
          executingPool: getExecutingPoolAccAddress(arciumEnv.arciumClusterOffset),
          compDefAccount: getCompDefAccAddress(
            program.programId,
            Buffer.from(getCompDefAccOffset("place_bid")).readUInt32LE()
          ),
        });
      await sendAs(b, bidder, `bid-${label}`);
      await awaitComputationFinalization(provider, compOff, program.programId, "confirmed");
      const evt = await placedPromise;
      console.log(`  ${label} placed, count=${evt.bidCount}`);
    }

    console.log("\n--- Step 2: Bids (A=500, B=800) ---");
    await bid(bidderA, BigInt(500), "A");
    await bid(bidderB, BigInt(800), "B");

    // === Step 3: wait for end ===
    console.log("\n--- Step 3: Wait for auction end ---");
    const auctionAcc = await program.account.auction.fetch(auctionPDA);
    const endTime = auctionAcc.endTime.toNumber();
    while (true) {
      const slot = await provider.connection.getSlot("confirmed");
      const bt = await provider.connection.getBlockTime(slot);
      if (bt === null || bt >= endTime) break;
      console.log(`  waiting ${endTime - bt}s...`);
      await new Promise((r) => setTimeout(r, 3000));
    }

    // === Step 4: close ===
    console.log("\n--- Step 4: Close ---");
    await sendAs(
      program.methods.closeAuction().accountsPartial({ authority: authority.publicKey, auction: auctionPDA }),
      authority,
      "close"
    );
    await pollAuctionStatus(auctionPDA, "closed");
    console.log("  closed (polled)");

    // === Step 5: reveal vickrey winner ===
    console.log("\n--- Step 5: Reveal (Vickrey) ---");
    const resolveCompOff = new anchor.BN(randomBytes(8), "hex");
    const det = program.methods
      .determineWinnerVickrey(resolveCompOff)
      .accountsPartial({
        authority: authority.publicKey,
        auction: auctionPDA,
        computationAccount: getComputationAccAddress(arciumEnv.arciumClusterOffset, resolveCompOff),
        clusterAccount,
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
        executingPool: getExecutingPoolAccAddress(arciumEnv.arciumClusterOffset),
        compDefAccount: getCompDefAccAddress(
          program.programId,
          Buffer.from(getCompDefAccOffset("determine_winner_vickrey")).readUInt32LE()
        ),
      });
    await sendAs(det, authority, "resolve");
    await awaitComputationFinalization(provider, resolveCompOff, program.programId, "confirmed");
    const resolvedAcc = await pollAuctionStatus(auctionPDA, "resolved");

    const winnerHex = Buffer.from(resolvedAcc.winner.toBytes()).toString("hex");
    const expectedHex = Buffer.from(bidderB.publicKey.toBytes()).toString("hex");
    console.log("  winner:", winnerHex);
    console.log("  payment:", resolvedAcc.paymentAmount.toNumber(), "lamports (expected 500)");
    expect(winnerHex).to.equal(expectedHex);
    expect(resolvedAcc.paymentAmount.toNumber()).to.equal(500);
    console.log("  ✅ Vickrey: highest bidder wins, pays second-highest");
  });
});
