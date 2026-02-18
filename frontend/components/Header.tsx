'use client';

interface HeaderProps {
    lastUpdated?: string;
    checkNumber?: number;
}

export function Header({ lastUpdated, checkNumber }: HeaderProps) {
    return (
        <header className="border-b border-sentinel-border bg-sentinel-card/50 backdrop-blur-sm sticky top-0 z-40">
            <div className="max-w-[1440px] mx-auto px-6 py-4 flex items-center justify-between">
                {/* Logo */}
                <div className="flex items-center gap-4">
                    <div className="relative">
                        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-sentinel-accent/20 to-sentinel-accent/5 border border-sentinel-accent/30 flex items-center justify-center">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#00E676" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                            </svg>
                        </div>
                        <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-sentinel-accent rounded-full status-dot" />
                    </div>
                    <div>
                        <h1 className="font-display font-bold text-lg tracking-tight text-sentinel-text">
                            SENTINAL
                        </h1>
                        <p className="text-[10px] font-mono text-sentinel-muted tracking-[0.3em]">
                            DEFI HEALTH MONITOR
                        </p>
                    </div>
                </div>

                {/* Right side */}
                <div className="flex items-center gap-6">
                    {checkNumber !== undefined && (
                        <div className="text-right">
                            <span className="text-[10px] font-mono text-sentinel-muted tracking-wider block">CHECK</span>
                            <span className="font-mono font-bold text-sentinel-accent">#{checkNumber}</span>
                        </div>
                    )}
                    {lastUpdated && (
                        <div className="text-right">
                            <span className="text-[10px] font-mono text-sentinel-muted tracking-wider block">LAST UPDATED</span>
                            <span className="font-mono text-xs text-sentinel-text">
                                {new Date(lastUpdated).toLocaleTimeString()}
                            </span>
                        </div>
                    )}
                    <a
                        href="https://sepolia.etherscan.io/address/0x155a5d68f2278d4a9398184871c9b8f62277c857"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1.5 rounded-lg border border-sentinel-border text-xs font-mono text-sentinel-muted hover:text-sentinel-accent hover:border-sentinel-accent/30 transition-all"
                    >
                        View on Etherscan ↗
                    </a>
                </div>
            </div>
        </header>
    );
}