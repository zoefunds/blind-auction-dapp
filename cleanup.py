from pathlib import Path

# --- #1: silence unused-var warning ---
rs = Path("programs/auction/programs/auction/src/lib.rs")
s = rs.read_text()
old1 = "        auction_nonce: u64,\n"
new1 = "        _auction_nonce: u64,\n"
if old1 in s:
    rs.write_text(s.replace(old1, new1, 1))
    print("[1] renamed auction_nonce -> _auction_nonce in lib.rs")
elif "_auction_nonce: u64," in s:
    print("[1] already patched")
else:
    print("[1] target not found, skipped")

# --- #2: delete dead findAuctionPda helper ---
cl = Path("app/lib/anchor/client.ts")
s = cl.read_text()
old2 = '''export function findAuctionPda(authority: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("auction"), authority.toBuffer()],
    PROGRAM_ID
  );
}

'''
if old2 in s:
    cl.write_text(s.replace(old2, ""))
    print("[2] deleted findAuctionPda from client.ts")
elif "findAuctionPda" not in s:
    print("[2] already removed")
else:
    print("[2] block not matched, skipped")

# --- #3: add Vickrey end-to-end test ---
tp = Path("programs/auction/tests/auction.ts")
s = tp.read_text()

if "Sealed-Bid Vickrey" in s:
    print("[3] vickrey test already present")
else:
    vickrey = r'''
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
    tx.recentBlockhash = (await provider.connection.getLatestBlockhash("confirmed")).blockhash;
    tx.sign(signer);
    const sig = await provider.connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    await provider.connection.confirmTransaction(sig, "confirmed");
    console.log(`  ${label} tx:`, sig);
    return sig;
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
    const closedPromise = awaitEvent("auctionClosedEvent", auctionPDA);
    await sendAs(
      program.methods.closeAuction().accountsPartial({ authority: authority.publicKey, auction: auctionPDA }),
      authority,
      "close"
    );
    await closedPromise;

    // === Step 5: reveal vickrey winner ===
    console.log("\n--- Step 5: Reveal (Vickrey) ---");
    const resolveCompOff = new anchor.BN(randomBytes(8), "hex");
    const resolvedPromise = awaitEvent("auctionResolvedEvent", auctionPDA);
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
    const resolved = await resolvedPromise;

    const winnerHex = Buffer.from(resolved.winner).toString("hex");
    const expectedHex = Buffer.from(bidderB.publicKey.toBytes()).toString("hex");
    console.log("  winner:", winnerHex);
    console.log("  payment:", resolved.paymentAmount.toNumber(), "lamports (expected 500)");
    expect(winnerHex).to.equal(expectedHex);
    expect(resolved.paymentAmount.toNumber()).to.equal(500);
    console.log("  ✅ Vickrey: highest bidder wins, pays second-highest");
  });
});
'''
    tp.write_text(s.rstrip() + "\n" + vickrey)
    print("[3] appended vickrey test to auction.ts")
