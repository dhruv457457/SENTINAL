import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SENTINAL | DeFi Health Monitor",
  description: "Multi-chain DeFi protocol health monitoring powered by Chainlink CRE",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen">
        <div className="noise-overlay" />
        {children}
      </body>
    </html>
  );
}