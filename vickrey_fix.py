from pathlib import Path

p = Path("programs/auction/tests/auction.ts")
s = p.read_text()

# 1) Make sendAs raise on confirmed-but-errored txs
old_sendas = '''  async function sendAs(builder: any, signer: anchor.web3.Keypair, label: string): Promise<string> {
    const tx = await builder.transaction();
    tx.feePayer = signer.publicKey;
    tx.recentBlockhash = (await provider.connection.getLatestBlockhash("confirmed")).blockhash;
    tx.sign(signer);
    const sig = await provider.connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    await provider.connection.confirmTransaction(sig, "confirmed");
    console.log(`  ${label} tx:`, sig);
    return sig;
  }'''
new_sendas = '''  async function sendAs(builder: any, signer: anchor.web3.Keypair, label: string): Promise<string> {
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
  }'''
s = s.replace(old_sendas, new_sendas)

# 2) Replace event-waiting in vickrey close/reveal with polling
s = s.replace(
    '''    // === Step 4: close ===
    console.log("\\n--- Step 4: Close ---");
    const closedPromise = awaitEvent("auctionClosedEvent", auctionPDA);
    await sendAs(
      program.methods.closeAuction().accountsPartial({ authority: authority.publicKey, auction: auctionPDA }),
      authority,
      "close"
    );
    await closedPromise;''',
    '''    // === Step 4: close ===
    console.log("\\n--- Step 4: Close ---");
    await sendAs(
      program.methods.closeAuction().accountsPartial({ authority: authority.publicKey, auction: auctionPDA }),
      authority,
      "close"
    );
    await pollAuctionStatus(auctionPDA, "closed");
    console.log("  closed (polled)");'''
)

s = s.replace(
    '''    // === Step 5: reveal vickrey winner ===
    console.log("\\n--- Step 5: Reveal (Vickrey) ---");
    const resolveCompOff = new anchor.BN(randomBytes(8), "hex");
    const resolvedPromise = awaitEvent("auctionResolvedEvent", auctionPDA);''',
    '''    // === Step 5: reveal vickrey winner ===
    console.log("\\n--- Step 5: Reveal (Vickrey) ---");
    const resolveCompOff = new anchor.BN(randomBytes(8), "hex");'''
)

s = s.replace(
    '''    await sendAs(det, authority, "resolve");
    await awaitComputationFinalization(provider, resolveCompOff, program.programId, "confirmed");
    const resolved = await resolvedPromise;

    const winnerHex = Buffer.from(resolved.winner).toString("hex");
    const expectedHex = Buffer.from(bidderB.publicKey.toBytes()).toString("hex");
    console.log("  winner:", winnerHex);
    console.log("  payment:", resolved.paymentAmount.toNumber(), "lamports (expected 500)");
    expect(winnerHex).to.equal(expectedHex);
    expect(resolved.paymentAmount.toNumber()).to.equal(500);''',
    '''    await sendAs(det, authority, "resolve");
    await awaitComputationFinalization(provider, resolveCompOff, program.programId, "confirmed");
    const resolvedAcc = await pollAuctionStatus(auctionPDA, "resolved");

    const winnerHex = Buffer.from(resolvedAcc.winner.toBytes()).toString("hex");
    const expectedHex = Buffer.from(bidderB.publicKey.toBytes()).toString("hex");
    console.log("  winner:", winnerHex);
    console.log("  payment:", resolvedAcc.paymentAmount.toNumber(), "lamports (expected 500)");
    expect(winnerHex).to.equal(expectedHex);
    expect(resolvedAcc.paymentAmount.toNumber()).to.equal(500);'''
)

p.write_text(s)
print("patched", p)
