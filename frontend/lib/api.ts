const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONTRACT ADDRESSES (V3)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export const ORACLE_ADDRESS = '0x71f540d7dac0fc71b6652b1d8aee9012638095ca';
export const GUARD_ADDRESS = '0xf9955c8b6e62eab7ab7fbedb4a2e90b6f6ad3905';
export const CONTROLLER_ADDRESS = '0x9153d2ded62384c06e30aa89997ba59d5c523085';
export const VAULT_ADDRESS = '0x29Ac4504A053f8Ac60127366fF69f91D4F32Bf58';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TYPES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface Protocol {
    name: string;
    type: string;
    chain: string;
    solvency: string;
    details: string;
    // NEW — velocity detection fields
    utilizationBps?: number;
    velocityBps?: number;
    velocityNegative?: boolean;
    velocityAlert?: boolean;
}

export interface VelocityAlert {
    name: string;
    velocityBps: number;
    currentUtilBps: number;
    prevUtilBps: number;
    velocityNegative: boolean;
}

export interface OffchainData {
    slug: string;
    tvl: string;
}

export interface Aggregate {
    totalActualUSD: string;
    totalClaimedUSD: string;
    worstSolvency: string;
    worstProtocol: string;
}

export interface HealthCheck {
    success: boolean;
    checkNumber: number;
    chains: string[];
    protocols: Protocol[];
    offchain: OffchainData[];
    aggregate: Aggregate;
    riskScore: number;
    severity: 'HEALTHY' | 'WARNING' | 'CRITICAL';
    anomalyDetected: boolean;
    txHash: string;
    receivedAt?: string;
    // NEW
    isFirstRun?: boolean;
    velocityAlerts?: VelocityAlert[];
}

export interface AlertConfig {
    discord: { enabled: boolean; webhookUrl: string };
    telegram: { enabled: boolean; botToken: string; chatId: string };
    alertOnHealthy: boolean;
    alertOnWarning: boolean;
    alertOnCritical: boolean;
}

// NEW — SentinalGuard status
export interface GuardStatus {
    globalPaused: boolean;
    severity: number;           // 0=HEALTHY 1=WARNING 2=CRITICAL
    registered: number;         // total registered protocols
    pauseEvents: number;
    lastUpdate: number;         // unix timestamp
}
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

export interface ProtocolGuardStatus {
    paused: boolean;
    warning: boolean;
    solvency: number;
    lastCheckNumber: number;
    lastUpdated: number;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// API FETCHERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function fetchLatest(): Promise<HealthCheck | null> {
    try {
        const res = await fetch(`${API_URL}/api/latest`, { cache: 'no-store' });
        if (!res.ok) return null;
        return res.json();
    } catch { return null; }
}

export async function fetchHistory(): Promise<HealthCheck[]> {
    try {
        const res = await fetch(`${API_URL}/api/history`, { cache: 'no-store' });
        if (!res.ok) return [];
        return res.json();
    } catch { return []; }
}

export async function fetchAlertConfig(): Promise<AlertConfig | null> {
    try {
        const res = await fetch(`${API_URL}/api/alerts/config`, { cache: 'no-store' });
        if (!res.ok) return null;
        return res.json();
    } catch { return null; }
}

export async function fetchGuardStatus(): Promise<GuardStatus | null> {
    try {
        const res = await fetch(`${API_URL}/api/guard/status`, { cache: 'no-store' });
        if (!res.ok) return null;
        return res.json();
    } catch { return null; }
}
export async function fetchVaultStatus(): Promise<VaultStatus | null> {
    try {
        const res = await fetch(`${API_URL}/api/vault/status`, { cache: 'no-store' });
        if (!res.ok) return null;
        return res.json();
    } catch { return null; }
}

export async function updateAlertConfig(config: AlertConfig): Promise<boolean> {
    const res = await fetch(`${API_URL}/api/alerts/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
    });
    return res.ok;
}

export async function testAlert(): Promise<any> {
    const res = await fetch(`${API_URL}/api/alerts/test`, { method: 'POST' });
    return res.json();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FORMATTERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function formatUSD(value: string | number): string {
    const num = typeof value === 'string' ? parseInt(value) : value;
    if (isNaN(num)) return '$0';
    if (num >= 1_000_000_000) return `$${(num / 1_000_000_000).toFixed(2)}B`;
    if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(1)}M`;
    if (num >= 1_000) return `$${(num / 1_000).toFixed(1)}K`;
    return `$${num.toLocaleString()}`;
}

export function formatBps(bps: number): string {
    return `${(bps / 100).toFixed(1)}%`;
}

export function getChainLabel(chain: string): string {
    const map: Record<string, string> = {
        'ethereum-mainnet': 'Ethereum',
        'ethereum-mainnet-arbitrum-1': 'Arbitrum',
        'ethereum-mainnet-base-1': 'Base',
    };
    return map[chain] || chain;
}

export function getChainColor(chain: string): string {
    const map: Record<string, string> = {
        'ethereum-mainnet': '#627EEA',
        'ethereum-mainnet-arbitrum-1': '#28A0F0',
        'ethereum-mainnet-base-1': '#0052FF',
    };
    return map[chain] || '#888';
}

export function getSeverityColor(severity: string | number): string {
    const s = typeof severity === 'number'
        ? (['HEALTHY', 'WARNING', 'CRITICAL'][severity] || 'HEALTHY')
        : severity;
    switch (s) {
        case 'HEALTHY': return '#00E676';
        case 'WARNING': return '#FFD600';
        case 'CRITICAL': return '#FF1744';
        default: return '#888';
    }
}

export function getSeverityLabel(severity: number): string {
    return ['HEALTHY', 'WARNING', 'CRITICAL'][severity] || 'UNKNOWN';
}