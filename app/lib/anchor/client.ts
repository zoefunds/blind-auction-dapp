"use client";

import { AnchorProvider, Program, web3 } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { useMemo } from "react";
import idl from "./auction.json";
import type { Auction } from "./auction";

export const PROGRAM_ID = new PublicKey(
  "C1L6yaUgu9rGbfbDzP61iyaqRrPrTJoUopMmjgLoVYzz"
);

export const ARCIUM_CLUSTER_OFFSET = 456; // Devnet cluster

export function useAnchorProgram(): Program<Auction> | null {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();

  return useMemo(() => {
    if (!wallet) return null;
    const provider = new AnchorProvider(connection, wallet, {
      commitment: "confirmed",
    });
    return new Program(idl as any, provider) as unknown as Program<Auction>;
  }, [connection, wallet]);
}

export const EXPLORER = (sig: string) =>
  `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
