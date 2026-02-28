'use client';

import { ORACLE_ADDRESS, GUARD_ADDRESS } from '@/lib/api';

interface HeaderProps {
    lastUpdated?: string;
    checkNumber?: number;
    isFirstRun?: boolean;
    guardPaused?: boolean;
}

export function Header({ lastUpdated, checkNumber, isFirstRun, guardPaused }: HeaderProps) {
    return (
        <header className="border-b border-sentinel-border bg-sentinel-card/50 backdrop-blur-sm sticky top-0 z-40">
            <div className="max-w-[1440px] mx-auto px-6 py-4 flex items-center justify-between">
                {/* Logo */}
                <div className="flex items-center gap-4">
                    <div className="relative">
                        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-sentinel-accent/20 to-sentinel-accent/5 border border-sentinel-accent/30 flex items-center justify-center">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#00E676"
                                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                            </svg>
                        </div>
                        {/* Live dot — red if guard paused */}
                        <div className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full status-dot`}
                            style={{ backgroundColor: guardPaused ? '#FF1744' : '#00E676' }} />
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
                <div className="flex items-center gap-4">
                    {/* First run badge */}
                    {isFirstRun && (
                        <span className="px-3 py-1 rounded-full border border-blue-500/30 bg-blue-500/10 text-blue-400 text-[10px] font-mono tracking-wider">
                            SEEDING BASELINE
                        </span>
                    )}

                    {/* Guard paused badge */}
                    {guardPaused && (
                        <span className="px-3 py-1 rounded-full border border-sentinel-critical/40 bg-sentinel-critical/10 text-sentinel-critical text-[10px] font-mono tracking-wider animate-pulse">
                            🚨 GUARD PAUSED
                        </span>
                    )}

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

                    <div className="flex items-center gap-2">
                        <a href={`https://sepolia.etherscan.io/address/${ORACLE_ADDRESS}`}
                            target="_blank" rel="noopener noreferrer"
                            className="px-3 py-1.5 rounded-lg border border-sentinel-border text-xs font-mono text-sentinel-muted hover:text-sentinel-accent hover:border-sentinel-accent/30 transition-all">
                            Oracle ↗
                        </a>
                        <a href={`https://sepolia.etherscan.io/address/${GUARD_ADDRESS}`}
                            target="_blank" rel="noopener noreferrer"
                            className="px-3 py-1.5 rounded-lg border border-sentinel-border text-xs font-mono text-sentinel-muted hover:text-sentinel-accent hover:border-sentinel-accent/30 transition-all">
                            Guard ↗
                        </a>
                    </div>
                </div>
            </div>
        </header>
    );
}