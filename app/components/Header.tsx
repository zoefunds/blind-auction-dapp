"use client";

import dynamic from "next/dynamic";
import Link from "next/link";

const WalletMultiButton = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false }
);

export default function Header() {
  return (
    <header className="border-b border-[var(--line)] bg-[var(--bg)] sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="mono text-sm font-bold tracking-tighter flex items-center gap-3">
          <span className="text-[var(--accent)]">▲</span>
          <span>BLINDBID</span>
          <span className="text-[var(--dim)]">/</span>
          <span className="text-[var(--dim)] font-normal">v0.1·devnet</span>
        </Link>
        <nav className="hidden md:flex items-center gap-8 mono text-xs uppercase tracking-wider">
          <Link href="/create" className="hover:text-[var(--accent)] transition">create</Link>
          <Link href="/auctions" className="hover:text-[var(--accent)] transition">browse</Link>
          <a href="https://github.com/zoefunds/blind-auction-dapp" target="_blank" rel="noreferrer" className="hover:text-[var(--accent)] transition">github↗</a>
        </nav>
        <WalletMultiButton />
      </div>
    </header>
  );
}
