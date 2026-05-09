import type { Metadata } from "next";
import "./globals.css";
import WalletProviders from "@/components/WalletProviders";

export const metadata: Metadata = {
  title: "BLINDBID // Sealed-bid auctions on Solana",
  description: "Encrypted bids. Decentralized MPC. Verifiable on-chain.",
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <WalletProviders>{children}</WalletProviders>
      </body>
    </html>
  );
}
