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
  getArciumProgram,
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
  x25519,
} from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";
import { expect } from "chai";

describe("Auction", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace
    .Auction as Program<Auction>;
  const provider = anchor.getProvider();
  const arciumProgram = getArciumProgram(provider as anchor.AnchorProvider);

  type Event = anchor.IdlEvents<(typeof program)["idl"]>;
  const awaitEvent = async <E extends keyof Event>(
    eventName: E,
  ): Promise<Event[E]> => {
    let listenerId: number;
    const event = await new Promise<Event[E]>((res) => {
      listenerId = program.addEventListener(eventName, (event) => {
        res(event);
      });
    });
    await program.removeEventListener(listenerId);

    return event;
  };

  const arciumEnv = getArciumEnv();
  const clusterAccount = getClusterAccAddress(arciumEnv.arciumClusterOffset);

  it("Is initialized!", async () => {
    const owner = readKpJson(`${os.homedir()}/.config/solana/id.json`);

    console.log("Checking if add_together computation definition exists...");
    const compDefPda = PublicKey.findProgramAddressSync(
      [
        getArciumAccountBaseSeed("ComputationDefinitionAccount"),
        program.programId.toBuffer(),
        getCompDefAccOffset("add_together_v2"),
      ],
      getArciumProgramId(),
    )[0];

    const existing = await provider.connection.getAccountInfo(compDefPda);
    if (existing) {
      console.log("Comp def already initialized — skipping init.");
    } else {
      console.log("Initializing add_together computation definition...");
      const initATSig = await initAddTogetherCompDef(program, owner);
      console.log("Initialized with signature:", initATSig);
    }

    const mxePublicKey = await getMXEPublicKeyWithRetry(
      provider as anchor.AnchorProvider,
      program.programId,
    );

    console.log("MXE x25519 pubkey is", mxePublicKey);

    const privateKey = x25519.utils.randomSecretKey();
    const publicKey = x25519.getPublicKey(privateKey);

    const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
    const cipher = new RescueCipher(sharedSecret);

    const val1 = BigInt(1);
    const val2 = BigInt(2);
    const plaintext = [val1, val2];

    const nonce = randomBytes(16);
    const ciphertext = cipher.encrypt(plaintext, nonce);

    const sumEventPromise = awaitEvent("sumEvent");
    const computationOffset = new anchor.BN(randomBytes(8), "hex");

    console.log("DEBUG program.programId:", program.programId.toBase58());
    console.log("DEBUG program.methods type:", typeof program.methods);
    console.log("DEBUG program.methods keys:", Object.keys(program.methods));
    console.log("DEBUG addTogether type:", typeof (program.methods as any).addTogether);
    console.log("DEBUG IDL instructions:", program.idl.instructions?.map((i:any) => i.name));

    let queueSig: string;
    try {
      // Build the transaction manually so we bypass Anchor 0.32's broken
      // SendTransactionError formatter (which throws "Unknown action 'undefined'"
      // before showing the real on-chain logs).
      const tx = await program.methods
        .addTogether(
          computationOffset,
          Array.from(ciphertext[0]),
          Array.from(ciphertext[1]),
          Array.from(publicKey),
          new anchor.BN(deserializeLE(nonce).toString()),
        )
        .accountsPartial({
          computationAccount: getComputationAccAddress(
            arciumEnv.arciumClusterOffset,
            computationOffset,
          ),
          clusterAccount,
          mxeAccount: getMXEAccAddress(program.programId),
          mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
          executingPool: getExecutingPoolAccAddress(
            arciumEnv.arciumClusterOffset,
          ),
          compDefAccount: getCompDefAccAddress(
            program.programId,
            Buffer.from(getCompDefAccOffset("add_together_v2")).readUInt32LE(),
          ),
        })
        .transaction();

      const conn = (provider as anchor.AnchorProvider).connection;
      const wallet = (provider as anchor.AnchorProvider).wallet;
      tx.feePayer = wallet.publicKey;
      tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;

      // First, try a simulation so we can see logs even if it would fail
      const sim = await conn.simulateTransaction(tx);
      console.log("=== SIMULATION RESULT ===");
      console.log("err:", JSON.stringify(sim.value.err, null, 2));
      console.log("logs:");
      (sim.value.logs ?? []).forEach((l) => console.log("  " + l));
      console.log("=== END SIMULATION ===");

      const signed = await wallet.signTransaction(tx);
      queueSig = await conn.sendRawTransaction(signed.serialize(), {
        skipPreflight: true,
      });
      await conn.confirmTransaction(queueSig, "confirmed");
    } catch (e: any) {
      console.log("=== CAUGHT ERROR ===");
      console.log("Error name:", e?.name);
      console.log("Error message:", e?.message);
      if (e?.logs) {
        console.log("Logs:");
        e.logs.forEach((l: string) => console.log("  " + l));
      }
      if (typeof e?.getLogs === "function") {
        try {
          const logs = await e.getLogs((provider as anchor.AnchorProvider).connection);
          console.log("getLogs():");
          logs.forEach((l: string) => console.log("  " + l));
        } catch {}
      }
      console.log("Full error:", e);
      console.log("=== END CAUGHT ===");
      throw e;
    }
    console.log("Queue sig is ", queueSig);

    const finalizeSig = await awaitComputationFinalization(
      provider as anchor.AnchorProvider,
      computationOffset,
      program.programId,
      "confirmed",
    );
    console.log("Finalize sig is ", finalizeSig);

    const sumEvent = await sumEventPromise;
    const decrypted = cipher.decrypt([sumEvent.sum], sumEvent.nonce)[0];
    expect(decrypted).to.equal(val1 + val2);
  });

  async function initAddTogetherCompDef(
    program: Program<Auction>,
    owner: anchor.web3.Keypair,
  ): Promise<string> {
    const baseSeedCompDefAcc = getArciumAccountBaseSeed(
      "ComputationDefinitionAccount",
    );
    const offset = getCompDefAccOffset("add_together_v2");

    const compDefPDA = PublicKey.findProgramAddressSync(
      [baseSeedCompDefAcc, program.programId.toBuffer(), offset],
      getArciumProgramId(),
    )[0];

    console.log("Comp def pda is ", compDefPDA);

    const mxeAccount = getMXEAccAddress(program.programId);
    const mxeAcc = await arciumProgram.account.mxeAccount.fetch(mxeAccount);
    const lutAddress = getLookupTableAddress(program.programId, mxeAcc.lutOffsetSlot);

    const sig = await program.methods
      .initAddTogetherCompDef()
      .accounts({
        compDefAccount: compDefPDA,
        payer: owner.publicKey,
        mxeAccount,
        addressLookupTable: lutAddress,
      })
      .signers([owner])
      .rpc({
        commitment: "confirmed",
      });
    console.log("Init add together computation definition transaction", sig);
    // Circuit hosted offchain via GitHub raw URL.
    // Arx Nodes fetch + verify hash from CircuitSource::OffChain in the program.

    return sig;
  }
});

async function getMXEPublicKeyWithRetry(
  provider: anchor.AnchorProvider,
  programId: PublicKey,
  maxRetries: number = 20,
  retryDelayMs: number = 500,
): Promise<Uint8Array> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const mxePublicKey = await getMXEPublicKey(provider, programId);
      if (mxePublicKey) {
        return mxePublicKey;
      }
    } catch (error) {
      console.log(`Attempt ${attempt} failed to fetch MXE public key:`, error);
    }

    if (attempt < maxRetries) {
      console.log(
        `Retrying in ${retryDelayMs}ms... (attempt ${attempt}/${maxRetries})`,
      );
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  throw new Error(
    `Failed to fetch MXE public key after ${maxRetries} attempts`,
  );
}

function readKpJson(path: string): anchor.web3.Keypair {
  const file = fs.readFileSync(path);
  return anchor.web3.Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(file.toString())),
  );
}
