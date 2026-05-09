import Header from "@/components/Header";
import Link from "next/link";

export default function Home() {
  return (
    <>
      <Header />
      <main>
        {/* HERO */}
        <section className="border-b border-[var(--line)]">
          <div className="max-w-7xl mx-auto px-6 py-32 grid md:grid-cols-12 gap-8">
            <div className="md:col-span-8">
              <div className="mono text-xs uppercase tracking-[0.2em] text-[var(--accent)] mb-8">
                ╳ Privacy preserving · MPC verified
              </div>
              <h1 className="text-6xl md:text-8xl font-bold tracking-tighter leading-[0.9]">
                Bids you<br/>
                <span className="text-[var(--dim)]">can&apos;t</span> see.<br/>
                Outcomes you<br/>
                <span className="text-[var(--accent)]">can</span> trust.
              </h1>
              <p className="mt-10 text-[var(--dim)] text-lg max-w-xl leading-relaxed">
                BlindBid runs sealed-bid auctions on Solana where every bid is encrypted client-side and computed by Arcium&apos;s decentralized MPC network. No node and no observer ever sees a losing bid.
              </p>
              <div className="mt-12 flex flex-wrap gap-3">
                <Link href="/create" className="mono text-sm uppercase tracking-wider px-6 h-12 inline-flex items-center bg-[var(--fg)] text-[var(--bg)] hover:bg-[var(--accent)] transition font-bold">
                  Create auction →
                </Link>
                <Link href="/auctions" className="mono text-sm uppercase tracking-wider px-6 h-12 inline-flex items-center border border-[var(--line)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition">
                  Browse open
                </Link>
              </div>
            </div>
            <div className="md:col-span-4 mono text-xs space-y-3 self-end">
              <Stat k="program" v="C1L6...VYzz" />
              <Stat k="cluster" v="Arcium // 456" />
              <Stat k="status" v="● live on devnet" accent />
              <Stat k="circuits" v="4 deployed" />
            </div>
          </div>
        </section>

        {/* HOW */}
        <section className="border-b border-[var(--line)]">
          <div className="max-w-7xl mx-auto px-6 py-24">
            <div className="mono text-xs uppercase tracking-[0.2em] text-[var(--dim)] mb-12">
              [01] How it works
            </div>
            <div className="grid md:grid-cols-3 gap-px bg-[var(--line)] border border-[var(--line)]">
              {[
                {n:"01", t:"You encrypt locally", d:"Your bid amount is encrypted in the browser using x25519 key-exchange and the Rescue cipher. The plaintext never touches the network."},
                {n:"02", t:"MPC nodes compute blind", d:"A cluster of Arx Nodes runs the bid-comparison circuit on encrypted shares. No single node — and no subset — can reconstruct any bid."},
                {n:"03", t:"You reveal the winner", d:"After the auction closes, the cluster signs an attestation revealing only the winning bidder and price. Losing bids stay encrypted forever."},
              ].map((s, i) => (
                <div key={i} className="bg-[var(--bg)] p-10 hover:bg-[var(--line)]/50 transition">
                  <div className="mono text-xs text-[var(--accent)] mb-6">[{s.n}]</div>
                  <div className="text-2xl font-bold tracking-tight mb-3">{s.t}</div>
                  <div className="text-sm text-[var(--dim)] leading-relaxed">{s.d}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* TECH */}
        <section className="border-b border-[var(--line)]">
          <div className="max-w-7xl mx-auto px-6 py-24 grid md:grid-cols-12 gap-12">
            <div className="md:col-span-4">
              <div className="mono text-xs uppercase tracking-[0.2em] text-[var(--dim)] mb-8">
                [02] Stack
              </div>
              <div className="text-3xl font-bold tracking-tight">
                Real infra. Not a demo.
              </div>
              <div className="mt-6 text-[var(--dim)]">
                Every transaction below is publicly verifiable on Solana Devnet.
              </div>
            </div>
            <div className="md:col-span-8 mono text-sm space-y-2">
              <Row k="chain"           v="Solana Devnet (cluster offset 456)" />
              <Row k="program"         v="auction.so · Anchor 0.32.1 · 640KB" />
              <Row k="circuits"        v="init_auction_state · place_bid · determine_winner_first_price · determine_winner_vickrey" />
              <Row k="hosted"          v="github raw // sha-256 verified" />
              <Row k="encryption"      v="x25519 + Rescue cipher (Arcis stdlib)" />
              <Row k="frontend"        v="Next.js 14 · TypeScript · Tailwind" />
              <Row k="wallets"         v="Phantom · Solflare (wallet-adapter)" />
              <Row k="build"           v="commit 39efab4" last />
            </div>
          </div>
        </section>

        {/* CTA */}
        <section>
          <div className="max-w-7xl mx-auto px-6 py-32 text-center">
            <div className="text-5xl font-bold tracking-tighter mb-8">
              Ready to run a private auction?
            </div>
            <Link href="/create" className="mono text-sm uppercase tracking-wider px-8 h-14 inline-flex items-center bg-[var(--accent)] text-[var(--bg)] hover:bg-[var(--fg)] transition font-bold">
              Create one in 30 seconds →
            </Link>
            <div className="mono text-xs text-[var(--dim)] mt-12">
              built with arcium · open source · zoefunds/blind-auction-dapp
            </div>
          </div>
        </section>
      </main>
    </>
  );
}

function Stat({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <div className="border-l-2 border-[var(--line)] pl-3 py-1">
      <div className="text-[10px] uppercase tracking-wider text-[var(--dim)]">{k}</div>
      <div className={accent ? "text-[var(--accent)]" : ""}>{v}</div>
    </div>
  );
}

function Row({ k, v, last }: { k: string; v: string; last?: boolean }) {
  return (
    <div className={`flex items-baseline gap-6 py-3 ${last ? "" : "border-b border-[var(--line)]"}`}>
      <div className="text-[var(--dim)] uppercase text-[10px] tracking-wider w-24 shrink-0">{k}</div>
      <div className="break-all">{v}</div>
    </div>
  );
}
