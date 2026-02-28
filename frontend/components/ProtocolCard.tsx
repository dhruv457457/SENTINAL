'use client';

import { Protocol, getChainLabel, getChainColor, formatBps } from '@/lib/api';

export function ProtocolCard({ protocol, delay }: { protocol: Protocol; delay: number }) {
    const solvency = parseFloat(protocol.solvency);
    const color = solvency >= 99 ? '#00E676' : solvency >= 95 ? '#FFD600' : '#FF1744';
    const chainColor = getChainColor(protocol.chain);
    const chainLabel = getChainLabel(protocol.chain);

    const utilMatch = protocol.details.match(/Util=(\d+\.?\d*)%/);
    const util = utilMatch ? parseFloat(utilMatch[1]) : null;

    const liqMatch = protocol.details.match(/Liq=\$(\d+)/);
    const borrowMatch = protocol.details.match(/Borrows=\$(\d+)/);
    const depositMatch = protocol.details.match(/Deposits=\$(\d+)/);

    const isLido = protocol.type === 'lido';

    // velocity fields
    const hasVelocity = protocol.velocityBps !== undefined && protocol.velocityBps !== null;
    const velocityAlert = protocol.velocityAlert === true;
    const velocityBps = protocol.velocityBps ?? 0;
    const velocityNeg = protocol.velocityNegative ?? false;
    const utilizationBps = protocol.utilizationBps ?? 0;

    return (
        <div
            className="card-hover relative bg-sentinel-card border border-sentinel-border rounded-xl p-5 overflow-hidden animate-slide-up"
            style={{
                animationDelay: `${delay}ms`,
                borderColor: velocityAlert ? '#FF174440' : undefined,
            }}
        >
            {/* Top scan line */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-sentinel-accent/20 to-transparent" />
            </div>

            {/* Velocity alert glow */}
            {velocityAlert && (
                <div className="absolute inset-0 pointer-events-none rounded-xl"
                    style={{ boxShadow: 'inset 0 0 20px #FF174415' }} />
            )}

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
                <div className="flex flex-col items-end gap-1.5">
                    <span className="px-2 py-0.5 text-[10px] font-mono font-bold tracking-wider rounded border"
                        style={{
                            color: chainColor,
                            borderColor: `${chainColor}40`,
                            background: `${chainColor}10`,
                        }}>
                        {protocol.type.toUpperCase()}
                    </span>
                    {/* Velocity badge */}
                    {hasVelocity && velocityAlert && (
                        <span className="px-2 py-0.5 text-[10px] font-mono font-bold tracking-wider rounded border border-sentinel-critical/40 bg-sentinel-critical/10 text-sentinel-critical">
                            ⚡ +{formatBps(velocityBps)}
                        </span>
                    )}
                    {hasVelocity && !velocityAlert && velocityBps > 0 && (
                        <span className="px-2 py-0.5 text-[10px] font-mono tracking-wider rounded border border-sentinel-border text-sentinel-muted">
                            {velocityNeg ? '▼' : '▲'} {formatBps(velocityBps)}
                        </span>
                    )}
                </div>
            </div>

            {/* Solvency bar */}
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

            {/* Utilization bar (new) */}
            {!isLido && utilizationBps > 0 && (
                <div className="mb-4">
                    <div className="flex items-baseline justify-between mb-1">
                        <span className="text-[10px] font-mono text-sentinel-muted tracking-wider">UTILIZATION</span>
                        <span className="font-mono text-xs text-sentinel-text">{formatBps(utilizationBps)}</span>
                    </div>
                    <div className="w-full h-1 rounded-full bg-sentinel-border overflow-hidden">
                        <div
                            className="h-full rounded-full transition-all duration-1000"
                            style={{
                                width: `${Math.min(utilizationBps / 100, 100)}%`,
                                backgroundColor: utilizationBps > 8500 ? '#FF1744' : utilizationBps > 7000 ? '#FFD600' : '#28A0F0',
                            }}
                        />
                    </div>
                </div>
            )}

            {/* Stats grid */}
            {!isLido && (
                <div className="grid grid-cols-2 gap-3">
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
                    {util !== null && (
                        <div>
                            <span className="text-[10px] font-mono text-sentinel-muted tracking-wider block">UTIL RATE</span>
                            <span className="font-mono text-sm text-sentinel-text">{util.toFixed(1)}%</span>
                        </div>
                    )}
                </div>
            )}

            {isLido && (
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <span className="text-[10px] font-mono text-sentinel-muted tracking-wider block">BACKING</span>
                        <span className="font-mono text-sm text-sentinel-text">{protocol.solvency}%</span>
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