from pathlib import Path

p = Path("programs/auction/tests/auction.ts")
src = p.read_text()

old = '''    const [auctionPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("auction"), auctionAuthority.publicKey.toBuffer()],
      program.programId
    );

    const auctionCreatedPromise = awaitEvent("auctionCreatedEvent", auctionPDA);

    const createBuilder = program.methods
      .createAuction(
        createCompOffset,
        { firstPrice: {} } as any,
        new anchor.BN(100),  // min_bid: 100 lamports
        new anchor.BN(120)   // duration: 15 seconds (fast for testing)
      )'''

new = '''    const auctionNonce = new anchor.BN(Date.now());
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
      )'''

if old not in src:
    if "auctionNonce" in src:
        print("already patched")
    else:
        raise SystemExit("target block not found")
else:
    p.write_text(src.replace(old, new))
    print("patched", p)
