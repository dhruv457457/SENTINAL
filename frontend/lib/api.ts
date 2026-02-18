const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export interface Protocol {
    name: string;
    type: string;
    chain: string;
    solvency: string;
    details: string;
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
}

export interface AlertConfig {
    discord: { enabled: boolean; webhookUrl: string };
    telegram: { enabled: boolean; botToken: string; chatId: string };
    alertOnHealthy: boolean;
    alertOnWarning: boolean;
    alertOnCritical: boolean;
}

export async function fetchLatest(): Promise<HealthCheck | null> {
    const res = await fetch(`${API_URL}/api/latest`, { cache: 'no-store' });
    if (!res.ok) return null;
    return res.json();
}

export async function fetchHistory(): Promise<HealthCheck[]> {
    const res = await fetch(`${API_URL}/api/history`, { cache: 'no-store' });
    if (!res.ok) return [];
    return res.json();
}

export async function fetchAlertConfig(): Promise<AlertConfig | null> {
    const res = await fetch(`${API_URL}/api/alerts/config`, { cache: 'no-store' });
    if (!res.ok) return null;
    return res.json();
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

export function formatUSD(value: string | number): string {
    const num = typeof value === 'string' ? parseInt(value) : value;
    if (num >= 1_000_000_000) return `$${(num / 1_000_000_000).toFixed(2)}B`;
    if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(1)}M`;
    if (num >= 1_000) return `$${(num / 1_000).toFixed(1)}K`;
    return `$${num.toLocaleString()}`;
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

export function getSeverityColor(severity: string): string {
    switch (severity) {
        case 'HEALTHY': return '#00E676';
        case 'WARNING': return '#FFD600';
        case 'CRITICAL': return '#FF1744';
        default: return '#888';
    }
}