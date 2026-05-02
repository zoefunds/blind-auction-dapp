# BlindBid

**Sealed-bid auctions on Solana with privacy-preserving bid comparison via [Arcium](https://www.arcium.com) MPC.**

Live demo: **https://blind-bids.vercel.app**

Bidders submit encrypted bids that are aggregated by a decentralized MPC cluster. No node, observer, or auction creator ever sees a losing bid. Only the winning bidder + price are revealed at the end.

---

## Why this exists

On-chain auctions are transparent by default — bids appear in the mempool the moment they're submitted. This creates problems:

- **Bid sniping** at the last second
- **MEV extraction** by validators reordering bids
- **Collusion** when bidders can see each other's offers
- **Strategic information leakage** in repeated auctions

Off-chain sealed-bid auctions solve these but require trusted auctioneers. BlindBid solves them without trust: bids are encrypted client-side, the comparison runs on Arcium's MPC network, and the contract on Solana enforces correctness.

---

## Architecture
                ┌────────────┐
                │  Browser   │
                │  (Next.js) │ ← user types bid
                └──────┬─────┘
                       │ encrypt(bid, x25519+Rescue)
                       ▼
                ┌──────────────┐
                │ Solana       │ ← deposit escrowed in PDA
                │ Auction      │
                │ Program      │
                └──────┬───────┘
                       │ CPI: queue_computation
                       ▼
                ┌──────────────┐
                │ Arcium MPC   │ ← compares bids on encrypted shares
                │ Cluster      │
                └──────┬───────┘
                       │ signed callback
                       ▼
                ┌──────────────┐
                │ Auction PDA  │ ← encrypted state updated
                └──────────────┘

### Components

| Layer | Tech | What it does |
|---|---|---|
| MPC circuits | Arcis (Rust DSL) | 4 circuits: `init_auction_state`, `place_bid`, `determine_winner_first_price`, `determine_winner_vickrey` |
| Solana program | Anchor 0.32 | Auction lifecycle, escrow, callbacks. Program ID: `C1L6yaUgu9rGbfbDzP61iyaqRrPrTJoUopMmjgLoVYzz` |
| Frontend | Next.js 14 + Tailwind | Wallet adapter, browser-side encryption, transaction building |
| Hosting | GitHub raw + Vercel | Circuits served from GitHub raw URLs (sha-256 verified by Arx Nodes); UI on Vercel |

### Encryption

- Bid amounts encrypted with **x25519** key exchange + **Rescue cipher** (Arcis stdlib)
- Bidder pubkey is split into two `u128` halves (`lo`, `hi`) because Arcis encrypts each primitive separately
- Encrypted state persists in the Auction PDA across multiple bids using `Enc<Mxe, AuctionState>` ownership

### Escrow + refund flow

Self-claim refund pattern preserves bid privacy:

1. Bidder calls `place_bid(encrypted_bid, deposit_amount)` — `deposit_amount ≥ min_bid`, transfers SOL into auction PDA
2. A `BidReceipt` PDA records `(bidder, deposit, claimed=false)` per bidder
3. After reveal, anyone who bid calls `claim_refund`:
   - **Winner** gets back `deposit - winning_bid`
   - **Loser** gets back full `deposit`

Privacy preserved because every deposit can be ≥ bid (loose upper bound only), not the bid itself.

---

## Auction types

- **First-price** — winner pays their own bid
- **Vickrey (second-price)** — winner pays the second-highest bid (incentivizes truthful bidding)

Both supported. MPC circuit chooses behavior based on `auction_type` enum.

---

## Try it locally

### Prerequisites

- Node 22.x
- Rust 1.89+
- Solana CLI 2.3+ (Agave)
- Anchor 0.32.1
- Arcium CLI 0.9.7

### Run frontend

```bash
git clone https://github.com/zoefunds/blind-auction-dapp
cd blind-auction-dapp/app
npm install --legacy-peer-deps
npm run dev
# open http://localhost:3000
```

The frontend points at the deployed devnet program. No need to deploy anything yourself.

### Run the test suite (calls real devnet)

```bash
cd blind-auction-dapp/programs/auction
yarn install
unset RUSTUP_TOOLCHAIN
arcium test --cluster devnet
```

This runs the full auction lifecycle end-to-end on Solana Devnet:
1. Initialize 4 computation definitions (skipped if already initialized)
2. Create an auction
3. Place an encrypted bid
4. Wait for auction to end
5. Close + reveal winner via MPC
6. Claim refund

Expect ~2 minutes total. The bid amount (500 lamports) is verified to never appear in plaintext on chain.

---

## Project structure
blind-auction-dapp/
├── app/                              # Next.js frontend
│   ├── app/
│   │   ├── page.tsx                  # Landing
│   │   ├── create/page.tsx           # Create auction
│   │   ├── auction/[pda]/page.tsx    # Bid + reveal + claim
│   │   └── auctions/page.tsx         # Browse all
│   ├── components/
│   │   ├── Header.tsx
│   │   └── WalletProviders.tsx
│   └── lib/anchor/                   # Synced IDL + types
├── programs/auction/                 # Arcium project
│   ├── encrypted-ixs/src/lib.rs      # 4 MPC circuits (Arcis DSL)
│   ├── programs/auction/src/lib.rs   # Anchor program (~950 lines)
│   ├── tests/auction.ts              # E2E test
│   └── build/                        # Compiled circuits, hosted via GitHub raw
└── README.md

---

## Verified on chain

Sample auction lifecycle, fully on Devnet:

- Auction created: [`HZAGv6RNu7cDLm3hMQMeHnmsoc3zfJ6sZwD3LYcq9Vca`](https://explorer.solana.com/address/HZAGv6RNu7cDLm3hMQMeHnmsoc3zfJ6sZwD3LYcq9Vca?cluster=devnet)
- Sample bid tx: [`669ASo8c...`](https://explorer.solana.com/tx/669ASo8cECcaU67KwBsNzp6GjS88bpJ2iVcpMdFWZxNwXUVfmowXiZwGnV9L14FDWFxVyg4sDAA38pCygzWEsQZG?cluster=devnet)
- Reveal tx: [`4tngn4CM...`](https://explorer.solana.com/tx/4tngn4CMuQvFmTmk3p6CpiUtgaQsx9rop9SbWrXz3DBxuXjzQ6ejwh4icNYmDPMr1kJSiwMThPNBkURQzokRb54L?cluster=devnet)

---

## Roadmap

- [x] First-price + Vickrey auction circuits
- [x] Frontend (create, bid, browse, claim refund)
- [x] SOL escrow + self-claim refund pattern
- [x] Multiple auctions per wallet (nonce-seeded PDAs)
- [x] Live on Solana Devnet
- [ ] USDC + SPL token bidding
- [ ] Mainnet deploy (after Arcium mainnet)
- [ ] Allowlisted/private auctions
- [ ] Auction NFT escrow (winner receives NFT atomically)
- [ ] Multi-bidder simulation tests in CI

---

## License

MIT

---

## Built with

- [Arcium](https://www.arcium.com) — encrypted MPC supercomputer
- [Solana](https://solana.com) — settlement layer
- [Anchor](https://www.anchor-lang.com/) — Solana framework
- [Next.js](https://nextjs.org/) — frontend
- [Tailwind](https://tailwindcss.com/) — styling

References Arcium's [official sealed-bid auction example](https://github.com/arcium-hq/examples/tree/main/sealed_bid_auction) by [@arihantbansal](https://github.com/arihantbansal).
