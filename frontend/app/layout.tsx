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
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&family=Space+Grotesk:wght@600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased min-h-screen">
        <div className="noise-overlay" />
        {children}
      </body>
    </html>
  );
}