'use client';

import { useEffect, useState } from 'react';
import { VAULT_ADDRESS, GUARD_ADDRESS } from '@/lib/api';

export interface VaultStatus {
    safe: boolean;
    globalPaused: boolean;
    registered: boolean;
    tvlEth: string;
    depositCount: number;
    blockedCount: number;
    vaultName: string;
    guardAddress: string;
}

interface VaultCardProps {
    guardPaused?: boolean;
}

export function VaultCard({ guardPaused = false }: VaultCardProps) {
    const [status, setStatus] = useState<VaultStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

    async function fetchVaultStatus() {
        try {
            const res = await fetch(`/api/vault/status`, { cache: 'no-store' });
            if (res.ok) {
                const data = await res.json();
                setStatus(data);
                setLastUpdated(new Date());
            }
        } catch {
            // fallback — derive from guardPaused prop if API not set up
            setStatus({
                safe: !guardPaused,
                globalPaused: guardPaused,
                registered: true,
                tvlEth: '0.01',
                depositCount: 2,
                blockedCount: 0,
                vaultName: 'SENTINAL Demo Vault',
                guardAddress: GUARD_ADDRESS,
            });
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        fetchVaultStatus();
        const interval = setInterval(fetchVaultStatus, 15_000);
        return () => clearInterval(interval);
    }, [guardPaused]);

    // Sync with guardPaused prop even without API
    const isSafe = status ? status.safe : !guardPaused;
    const isPaused = status ? status.globalPaused : guardPaused;

    const statusColor = isSafe ? '#00E676' : '#FF1744';
    const statusLabel = isSafe ? 'SAFE' : 'PAUSED';
    const statusBg = isSafe ? '#00E67615' : '#FF174415';
    const statusBorder = isSafe ? '#00E67640' : '#FF174440';

    return (
        <div
            className="bg-sentinel-card border border-sentinel-border rounded-xl p-6 animate-slide-up"
            style={{
                borderColor: isPaused ? '#FF174440' : undefined,
                boxShadow: isPaused ? '0 0 30px #FF174415' : undefined,
                animationDelay: '450ms',
            }}
        >
            {/* Header */}
            <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                    <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center"
                        style={{ background: `${statusColor}15`, border: `1px solid ${statusColor}30` }}
                    >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={statusColor} strokeWidth="2">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                        </svg>
                    </div>
                    <span className="text-[10px] font-mono text-sentinel-muted tracking-[0.2em]">
                        MOCK VAULT — DEMO
                    </span>
                </div>

                {/* Status pill */}
                <div
                    className="flex items-center gap-2 px-3 py-1.5 rounded-full border"
                    style={{ borderColor: statusBorder, background: statusBg }}
                >
                    <span
                        className="w-2 h-2 rounded-full animate-pulse"
                        style={{ backgroundColor: statusColor }}
                    />
                    <span className="font-mono text-xs font-bold" style={{ color: statusColor }}>
                        {statusLabel}
                    </span>
                </div>
            </div>

            {/* Vault name */}
            <div className="mb-5">
                <span className="font-mono font-bold text-sentinel-text text-base">
                    {status?.vaultName ?? 'SENTINAL Demo Vault'}
                </span>
                <span className="block text-[10px] font-mono text-sentinel-muted mt-0.5 tracking-wider">
                    Protected by SentinalGuard circuit breaker
                </span>
            </div>

            {/* Big circuit breaker status */}
            <div
                className="rounded-lg p-4 mb-5 border text-center"
                style={{
                    background: statusBg,
                    borderColor: statusBorder,
                }}
            >
                {isSafe ? (
                    <>
                        <div className="text-2xl mb-1">🟢</div>
                        <div className="font-mono font-bold text-sm" style={{ color: statusColor }}>
                            CIRCUIT BREAKER CLOSED
                        </div>
                        <div className="text-[10px] font-mono text-sentinel-muted mt-1">
                            Deposits &amp; withdrawals open
                        </div>
                    </>
                ) : (
                    <>
                        <div className="text-2xl mb-1 animate-pulse">🔴</div>
                        <div className="font-mono font-bold text-sm animate-pulse" style={{ color: statusColor }}>
                            CIRCUIT BREAKER OPEN
                        </div>
                        <div className="text-[10px] font-mono text-sentinel-muted mt-1">
                            All transactions blocked — funds protected
                        </div>
                    </>
                )}
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-3 mb-5">
                <div className="p-3 rounded-lg bg-sentinel-bg border border-sentinel-border text-center">
                    <span className="text-[10px] font-mono text-sentinel-muted tracking-wider block mb-1">TVL</span>
                    <span className="font-mono font-bold text-base text-sentinel-text">
                        {loading ? '—' : `${status?.tvlEth ?? '0'} ETH`}
                    </span>
                </div>
                <div className="p-3 rounded-lg bg-sentinel-bg border border-sentinel-border text-center">
                    <span className="text-[10px] font-mono text-sentinel-muted tracking-wider block mb-1">DEPOSITS</span>
                    <span className="font-mono font-bold text-base text-sentinel-accent">
                        {loading ? '—' : (status?.depositCount ?? 0)}
                    </span>
                </div>
                <div className="p-3 rounded-lg bg-sentinel-bg border border-sentinel-border text-center">
                    <span className="text-[10px] font-mono text-sentinel-muted tracking-wider block mb-1">BLOCKED</span>
                    <span
                        className="font-mono font-bold text-base"
                        style={{ color: (status?.blockedCount ?? 0) > 0 ? '#FF1744' : '#64748B' }}
                    >
                        {loading ? '—' : (status?.blockedCount ?? 0)}
                    </span>
                </div>
            </div>

            {/* What happens when paused */}
            <div className="mb-4 p-3 rounded-lg bg-sentinel-bg border border-sentinel-border">
                <span className="text-[10px] font-mono text-sentinel-muted tracking-[0.2em] block mb-2">
                    REVERT MESSAGE WHEN PAUSED
                </span>
                <code className="text-[10px] font-mono text-yellow-400 break-all">
                    "SENTINAL: circuit breaker active"
                </code>
            </div>

            {/* Integration snippet */}
            <div className="mb-4">
                <span className="text-[10px] font-mono text-sentinel-muted tracking-[0.2em] block mb-2">
                    HOW IT WORKS — 1 LINE IN DEPOSIT()
                </span>
                <div className="bg-sentinel-bg border border-sentinel-border rounded-lg px-4 py-3 font-mono text-[10px] space-y-1">
                    <div className="text-sentinel-muted">function <span className="text-blue-400">deposit</span>() external payable {'{'}</div>
                    <div className="pl-4">
                        <span className="text-purple-400">require</span>(
                        <span className="text-sentinel-accent">GUARD.isSafe</span>(
                        <span className="text-yellow-400">address(this)</span>));
                    </div>
                    <div className="pl-4 text-sentinel-muted/50">// ... rest of deposit logic</div>
                    <div className="text-sentinel-muted">{'}'}</div>
                </div>
            </div>

            {/* Registration status */}
            <div className="flex items-center gap-2 mb-4 p-3 rounded-lg bg-sentinel-bg border border-sentinel-border">
                <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: status?.registered ? '#00E676' : '#FF1744' }}
                />
                <span className="text-[10px] font-mono text-sentinel-muted">
                    {status?.registered
                        ? 'Registered on SentinalGuard — watching Aave V3 + Lido stETH'
                        : 'Not registered on SentinalGuard'}
                </span>
            </div>

            {/* Etherscan links */}
            <div className="flex gap-3">
                <a
                    href={`https://sepolia.etherscan.io/address/${VAULT_ADDRESS}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 text-center px-3 py-2 rounded-lg border border-sentinel-border text-[10px] font-mono text-sentinel-muted hover:text-sentinel-accent hover:border-sentinel-accent/30 transition-all"
                >
                    Vault ↗
                </a>
                <a
                    href={`https://sepolia.etherscan.io/address/${GUARD_ADDRESS}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 text-center px-3 py-2 rounded-lg border border-sentinel-border text-[10px] font-mono text-sentinel-muted hover:text-sentinel-accent hover:border-sentinel-accent/30 transition-all"
                >
                    Guard ↗
                </a>
                <a
                    href={`https://sepolia.etherscan.io/address/${VAULT_ADDRESS}#events`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 text-center px-3 py-2 rounded-lg border border-sentinel-border text-[10px] font-mono text-sentinel-muted hover:text-sentinel-accent hover:border-sentinel-accent/30 transition-all"
                >
                    Events ↗
                </a>
            </div>

            {lastUpdated && (
                <div className="mt-3 text-center">
                    <span className="text-[9px] font-mono text-sentinel-muted/50">
                        updated {lastUpdated.toLocaleTimeString()}
                    </span>
                </div>
            )}
        </div>
    );
}