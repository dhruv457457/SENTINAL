'use client';

import { GuardStatus, getSeverityLabel, getSeverityColor, GUARD_ADDRESS, ORACLE_ADDRESS } from '@/lib/api';

interface GuardPanelProps {
    status: GuardStatus | null;
    velocityAlerts?: { name: string; velocityBps: number; currentUtilBps: number; prevUtilBps: number; velocityNegative: boolean }[];
    isFirstRun?: boolean;
}

export function GuardPanel({ status, velocityAlerts = [], isFirstRun = false }: GuardPanelProps) {
    const paused = status?.globalPaused ?? false;
    const severityLabel = status ? getSeverityLabel(status.severity) : 'UNKNOWN';
    const severityColor = getSeverityColor(severityLabel);

    return (
        <div className="bg-sentinel-card border border-sentinel-border rounded-xl p-6 animate-slide-up"
            style={{
                borderColor: paused ? '#FF174440' : undefined,
                boxShadow: paused ? '0 0 20px #FF174415' : undefined,
            }}>
            {/* Header */}
            <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                        style={{ background: `${severityColor}15`, border: `1px solid ${severityColor}30` }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                            stroke={severityColor} strokeWidth="2">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                        </svg>
                    </div>
                    <span className="text-[10px] font-mono text-sentinel-muted tracking-[0.2em]">
                        SENTINAL GUARD
                    </span>
                </div>
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border`}
                    style={{ borderColor: `${severityColor}40`, background: `${severityColor}10` }}>
                    <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: severityColor }} />
                    <span className="font-mono text-xs font-bold" style={{ color: severityColor }}>
                        {paused ? 'PAUSED' : severityLabel}
                    </span>
                </div>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-4 mb-5">
                <div className="p-3 rounded-lg bg-sentinel-bg border border-sentinel-border">
                    <span className="text-[10px] font-mono text-sentinel-muted tracking-wider block mb-1">REGISTERED</span>
                    <span className="font-mono font-bold text-xl text-sentinel-text">
                        {status?.registered ?? '—'}
                    </span>
                    <span className="text-[10px] font-mono text-sentinel-muted block">protocols</span>
                </div>
                <div className="p-3 rounded-lg bg-sentinel-bg border border-sentinel-border">
                    <span className="text-[10px] font-mono text-sentinel-muted tracking-wider block mb-1">PAUSE EVENTS</span>
                    <span className="font-mono font-bold text-xl"
                        style={{ color: (status?.pauseEvents ?? 0) > 0 ? '#FFD600' : '#64748B' }}>
                        {status?.pauseEvents ?? '—'}
                    </span>
                    <span className="text-[10px] font-mono text-sentinel-muted block">total</span>
                </div>
                <div className="p-3 rounded-lg bg-sentinel-bg border border-sentinel-border">
                    <span className="text-[10px] font-mono text-sentinel-muted tracking-wider block mb-1">CIRCUIT</span>
                    <span className="font-mono font-bold text-xl"
                        style={{ color: paused ? '#FF1744' : '#00E676' }}>
                        {paused ? 'OPEN' : 'CLOSED'}
                    </span>
                    <span className="text-[10px] font-mono text-sentinel-muted block">
                        {paused ? 'blocking' : 'passing'}
                    </span>
                </div>
            </div>

            {/* Velocity alerts */}
            <div className="mb-4">
                <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px] font-mono text-sentinel-muted tracking-[0.2em]">⚡ VELOCITY MONITOR</span>
                    {isFirstRun && (
                        <span className="px-2 py-0.5 text-[10px] font-mono rounded border border-blue-500/30 bg-blue-500/10 text-blue-400">
                            SEEDING BASELINE
                        </span>
                    )}
                </div>

                {isFirstRun ? (
                    <div className="p-3 rounded-lg bg-sentinel-bg border border-sentinel-border text-center">
                        <span className="font-mono text-xs text-sentinel-muted">
                            ℹ️ First run — baseline stored. Velocity active from next check.
                        </span>
                    </div>
                ) : velocityAlerts.length === 0 ? (
                    <div className="p-3 rounded-lg bg-sentinel-bg border border-sentinel-border text-center">
                        <span className="font-mono text-xs text-sentinel-accent">✅ All utilization rates stable</span>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {velocityAlerts.map(v => (
                            <div key={v.name}
                                className="flex items-center justify-between p-3 rounded-lg bg-sentinel-critical/5 border border-sentinel-critical/30">
                                <div>
                                    <span className="font-mono text-xs text-sentinel-text block">{v.name}</span>
                                    <span className="font-mono text-[10px] text-sentinel-muted">
                                        {(v.prevUtilBps / 100).toFixed(1)}% → {(v.currentUtilBps / 100).toFixed(1)}%
                                        {v.velocityNegative ? ' ▼' : ' ▲'}
                                    </span>
                                </div>
                                <span className="font-mono text-sm font-bold text-sentinel-critical">
                                    ⚡ +{(v.velocityBps / 100).toFixed(1)}%/cycle
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Integration snippet */}
            <div className="pt-4 border-t border-sentinel-border">
                <span className="text-[10px] font-mono text-sentinel-muted tracking-[0.2em] block mb-2">
                    INTEGRATION — 3 LINES
                </span>
                <div className="bg-sentinel-bg border border-sentinel-border rounded-lg px-4 py-3 font-mono text-[10px] text-sentinel-muted space-y-1">
                    <div><span className="text-blue-400">ISentinalGuard</span> guard = ISentinalGuard(<span className="text-sentinel-accent">{GUARD_ADDRESS.slice(0, 10)}...</span>);</div>
                    <div>watched[0] = <span className="text-yellow-400">"Aave V3 USDC (Ethereum)"</span>;</div>
                    <div>guard.<span className="text-sentinel-accent">register</span>(watched);</div>
                    <div className="text-sentinel-muted/60 pt-1">// In deposit(): require(guard.isSafe(address(this)));</div>
                </div>
            </div>

            {/* Etherscan links */}
            <div className="flex gap-3 mt-4">
                <a href={`https://sepolia.etherscan.io/address/${GUARD_ADDRESS}`}
                    target="_blank" rel="noopener noreferrer"
                    className="flex-1 text-center px-3 py-2 rounded-lg border border-sentinel-border text-[10px] font-mono text-sentinel-muted hover:text-sentinel-accent hover:border-sentinel-accent/30 transition-all">
                    Guard ↗
                </a>
                <a href={`https://sepolia.etherscan.io/address/${ORACLE_ADDRESS}`}
                    target="_blank" rel="noopener noreferrer"
                    className="flex-1 text-center px-3 py-2 rounded-lg border border-sentinel-border text-[10px] font-mono text-sentinel-muted hover:text-sentinel-accent hover:border-sentinel-accent/30 transition-all">
                    Oracle ↗
                </a>
            </div>
        </div>
    );
}