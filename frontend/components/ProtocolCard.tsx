'use client';

import { Protocol, getChainLabel, getChainColor } from '@/lib/api';

export function ProtocolCard({ protocol, delay }: { protocol: Protocol; delay: number }) {
    const solvency = parseFloat(protocol.solvency);
    const color = solvency >= 99 ? '#00E676' : solvency >= 95 ? '#FFD600' : '#FF1744';
    const chainColor = getChainColor(protocol.chain);
    const chainLabel = getChainLabel(protocol.chain);

    // Parse details
    const utilMatch = protocol.details.match(/Util=(\d+\.?\d*)%/);
    const util = utilMatch ? parseFloat(utilMatch[1]) : null;

    const liqMatch = protocol.details.match(/Liq=\$(\d+)/);
    const borrowMatch = protocol.details.match(/Borrows=\$(\d+)/);
    const depositMatch = protocol.details.match(/Deposits=\$(\d+)/);

    const isLido = protocol.type === 'lido';

    return (
        <div
            className="card-hover relative bg-sentinel-card border border-sentinel-border rounded-xl p-5 overflow-hidden animate-slide-up"
            style={{ animationDelay: `${delay}ms` }}
        >
            {/* Scan line effect */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-sentinel-accent/20 to-transparent" />
            </div>

            {/* Header */}
            <div className="flex items-start justify-between mb-4">
                <div>
                    <h3 className="font-display font-semibold text-sentinel-text text-sm">
                        {protocol.name}
                    </h3>
                    <div className="flex items-center gap-2 mt-1">
                        <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: chainColor }} />
                        <span className="text-xs font-mono text-sentinel-muted">{chainLabel}</span>
                    </div>
                </div>
                <span className="px-2 py-0.5 text-[10px] font-mono font-bold tracking-wider rounded border"
                    style={{
                        color: chainColor,
                        borderColor: `${chainColor}40`,
                        background: `${chainColor}10`,
                    }}>
                    {protocol.type.toUpperCase()}
                </span>
            </div>

            {/* Solvency */}
            <div className="mb-4">
                <div className="flex items-baseline justify-between mb-2">
                    <span className="text-xs font-mono text-sentinel-muted tracking-wider">SOLVENCY</span>
                    <span className="font-mono font-bold text-lg" style={{ color }}>
                        {protocol.solvency}%
                    </span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-sentinel-border overflow-hidden">
                    <div
                        className="h-full rounded-full transition-all duration-1000 ease-out"
                        style={{
                            width: `${Math.min(solvency, 100)}%`,
                            backgroundColor: color,
                            boxShadow: `0 0 8px ${color}60`,
                        }}
                    />
                </div>
            </div>

            {/* Stats */}
            {!isLido && (
                <div className="grid grid-cols-2 gap-3">
                    {util !== null && (
                        <div>
                            <span className="text-[10px] font-mono text-sentinel-muted tracking-wider block">UTILIZATION</span>
                            <span className="font-mono text-sm text-sentinel-text">{util.toFixed(1)}%</span>
                        </div>
                    )}
                    {depositMatch && (
                        <div>
                            <span className="text-[10px] font-mono text-sentinel-muted tracking-wider block">DEPOSITS</span>
                            <span className="font-mono text-sm text-sentinel-text">
                                ${(parseInt(depositMatch[1]) / 1e6).toFixed(0)}M
                            </span>
                        </div>
                    )}
                    {liqMatch && (
                        <div>
                            <span className="text-[10px] font-mono text-sentinel-muted tracking-wider block">LIQUIDITY</span>
                            <span className="font-mono text-sm text-sentinel-text">
                                ${(parseInt(liqMatch[1]) / 1e6).toFixed(0)}M
                            </span>
                        </div>
                    )}
                    {borrowMatch && (
                        <div>
                            <span className="text-[10px] font-mono text-sentinel-muted tracking-wider block">BORROWS</span>
                            <span className="font-mono text-sm text-sentinel-text">
                                ${(parseInt(borrowMatch[1]) / 1e6).toFixed(0)}M
                            </span>
                        </div>
                    )}
                </div>
            )}

            {isLido && (
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <span className="text-[10px] font-mono text-sentinel-muted tracking-wider block">BACKING</span>
                        <span className="font-mono text-sm text-sentinel-text">
                            {protocol.solvency}%
                        </span>
                    </div>
                    <div>
                        <span className="text-[10px] font-mono text-sentinel-muted tracking-wider block">TYPE</span>
                        <span className="font-mono text-sm text-sentinel-text">LST</span>
                    </div>
                </div>
            )}
        </div>
    );
}