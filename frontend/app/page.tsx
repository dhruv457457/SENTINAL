'use client';

import { useEffect, useState, useCallback } from 'react';
import { HealthCheck, fetchLatest, fetchHistory, formatUSD } from '@/lib/api';
import { Header } from '@/components/Header';
import { StatusBadge } from '@/components/StatusBadge';
import { RiskGauge } from '@/components/RiskGauge';
import { ProtocolCard } from '@/components/ProtocolCard';
import { StatCard } from '@/components/StatCard';
import { HistoryChart } from '@/components/HistoryChart';
import { ChainBadge } from '@/components/ChainBadge';

// SVG Icons
const ShieldIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
);
const LayersIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></svg>
);
const LinkIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
);
const DollarIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
);
const GlobeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>
);
const AlertIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
);
const ActivityIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
);

const POLL_INTERVAL = 15000; // 15 seconds

export default function Dashboard() {
  const [latest, setLatest] = useState<HealthCheck | null>(null);
  const [history, setHistory] = useState<HealthCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [latestData, historyData] = await Promise.all([
        fetchLatest(),
        fetchHistory(),
      ]);
      if (latestData) setLatest(latestData);
      if (historyData) setHistory(historyData);
      setLastFetch(new Date());
    } catch (err) {
      console.error('Failed to fetch data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [loadData]);

  if (loading) {
    return (
      <div className="min-h-screen grid-bg flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-sentinel-accent/10 border border-sentinel-accent/30 flex items-center justify-center animate-pulse">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#00E676" strokeWidth="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </div>
          <p className="font-mono text-sentinel-muted text-sm tracking-wider">INITIALIZING SENTINAL...</p>
        </div>
      </div>
    );
  }

  if (!latest) {
    return (
      <div className="min-h-screen grid-bg flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-sentinel-card border border-sentinel-border flex items-center justify-center">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </div>
          <h2 className="font-display font-bold text-xl text-sentinel-text mb-2">No Data Yet</h2>
          <p className="font-mono text-sm text-sentinel-muted">
            Start the SENTINAL runner to begin monitoring.
          </p>
          <code className="block mt-4 px-4 py-2 bg-sentinel-card border border-sentinel-border rounded-lg font-mono text-xs text-sentinel-accent">
            node scripts/run-and-report.mjs
          </code>
        </div>
      </div>
    );
  }

  const totalTVL = latest.offchain.reduce((sum, o) => sum + parseInt(o.tvl), 0);

  return (
    <div className="min-h-screen grid-bg">
      <Header
        lastUpdated={latest.receivedAt || lastFetch?.toISOString()}
        checkNumber={latest.checkNumber}
      />

      <main className="max-w-[1440px] mx-auto px-6 py-8">
        {/* ── Hero Section ───────────────────────────── */}
        <section className="mb-10 animate-fade-in">
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
            <div>
              <div className="flex items-center gap-4 mb-3">
                <StatusBadge severity={latest.severity} />
                {latest.anomalyDetected && (
                  <span className="px-3 py-1 rounded-full border border-sentinel-critical/30 bg-sentinel-critical/10 text-sentinel-critical text-xs font-mono">
                    ⚠ ANOMALY DETECTED
                  </span>
                )}
              </div>
              <p className="text-sentinel-muted text-sm font-body max-w-lg">
                Monitoring {latest.protocols.length} protocols across {latest.chains.length} chains
                with {formatUSD(latest.aggregate.totalActualUSD)} in aggregate reserves.
                Powered by Chainlink CRE with DON-signed onchain reports.
              </p>
            </div>
            <RiskGauge score={latest.riskScore} />
          </div>
        </section>

        {/* ── Chain Coverage ─────────────────────────── */}
        <section className="mb-8 animate-fade-in" style={{ animationDelay: '100ms' }}>
          <div className="flex items-center gap-3 mb-4">
            <span className="text-[10px] font-mono text-sentinel-muted tracking-[0.2em]">CHAIN COVERAGE</span>
            <div className="flex-1 h-px bg-sentinel-border" />
          </div>
          <div className="flex flex-wrap gap-2">
            {latest.chains.map(chain => (
              <ChainBadge key={chain} chain={chain} />
            ))}
          </div>
        </section>

        {/* ── Key Metrics ────────────────────────────── */}
        <section className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <span className="text-[10px] font-mono text-sentinel-muted tracking-[0.2em]">KEY METRICS</span>
            <div className="flex-1 h-px bg-sentinel-border" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <StatCard
              label="Reserves"
              value={formatUSD(latest.aggregate.totalActualUSD)}
              icon={<DollarIcon />}
              color="#00E676"
              delay={100}
            />
            <StatCard
              label="Protocols"
              value={latest.protocols.length}
              icon={<LayersIcon />}
              color="#3B82F6"
              delay={150}
            />
            <StatCard
              label="Chains"
              value={latest.chains.length}
              icon={<LinkIcon />}
              color="#8B5CF6"
              delay={200}
            />
            <StatCard
              label="Total TVL"
              value={formatUSD(totalTVL)}
              icon={<GlobeIcon />}
              subtitle="DeFiLlama"
              color="#06B6D4"
              delay={250}
            />
            <StatCard
              label="Checks"
              value={history.length}
              icon={<ShieldIcon />}
              color="#F59E0B"
              delay={300}
            />
            <StatCard
              label="Anomalies"
              value={history.filter(h => h.anomalyDetected).length}
              icon={<AlertIcon />}
              color={history.some(h => h.anomalyDetected) ? '#FF1744' : '#64748B'}
              delay={350}
            />
          </div>
        </section>

        {/* ── Protocol Grid ──────────────────────────── */}
        <section className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <span className="text-[10px] font-mono text-sentinel-muted tracking-[0.2em]">PROTOCOL SOLVENCY</span>
            <div className="flex-1 h-px bg-sentinel-border" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {latest.protocols.map((protocol, i) => (
              <ProtocolCard key={protocol.name} protocol={protocol} delay={i * 80} />
            ))}
          </div>
        </section>

        {/* ── History + TVL ───────────────────────────── */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">
          {/* History Chart */}
          <div className="lg:col-span-2 bg-sentinel-card border border-sentinel-border rounded-xl p-6 animate-slide-up" style={{ animationDelay: '400ms' }}>
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <ActivityIcon />
                <span className="text-[10px] font-mono text-sentinel-muted tracking-[0.2em]">RISK HISTORY</span>
              </div>
              <span className="text-xs font-mono text-sentinel-muted">
                Last {Math.min(history.length, 30)} checks
              </span>
            </div>
            <HistoryChart history={history} />
          </div>

          {/* DeFiLlama TVL */}
          <div className="bg-sentinel-card border border-sentinel-border rounded-xl p-6 animate-slide-up" style={{ animationDelay: '500ms' }}>
            <div className="flex items-center gap-3 mb-6">
              <GlobeIcon />
              <span className="text-[10px] font-mono text-sentinel-muted tracking-[0.2em]">OFFCHAIN TVL</span>
            </div>
            <div className="space-y-4">
              {latest.offchain.map(o => (
                <div key={o.slug} className="flex items-center justify-between p-3 rounded-lg bg-sentinel-bg border border-sentinel-border">
                  <div>
                    <span className="font-mono text-sm text-sentinel-text capitalize">{o.slug}</span>
                    <span className="block text-[10px] font-mono text-sentinel-muted mt-0.5">DeFiLlama</span>
                  </div>
                  <span className="font-mono font-bold text-lg text-sentinel-accent">
                    {formatUSD(o.tvl)}
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-6 pt-4 border-t border-sentinel-border">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-sentinel-muted tracking-wider">TOTAL TVL</span>
                <span className="font-mono font-bold text-xl text-sentinel-text">
                  {formatUSD(totalTVL)}
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* ── Transaction + Details ───────────────────── */}
        <section className="mb-8 animate-slide-up" style={{ animationDelay: '600ms' }}>
          <div className="bg-sentinel-card border border-sentinel-border rounded-xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <span className="text-[10px] font-mono text-sentinel-muted tracking-[0.2em]">LATEST ONCHAIN REPORT</span>
              <div className="flex-1 h-px bg-sentinel-border" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <span className="text-[10px] font-mono text-sentinel-muted tracking-wider block mb-1">TX HASH</span>
                {latest.txHash && !latest.txHash.startsWith('0x000000') ? (
                  <a
                    href={`https://sepolia.etherscan.io/tx/${latest.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-xs text-sentinel-accent hover:underline"
                  >
                    {latest.txHash.slice(0, 10)}...{latest.txHash.slice(-8)}
                  </a>
                ) : (
                  <span className="font-mono text-xs text-sentinel-muted">Simulation mode</span>
                )}
              </div>
              <div>
                <span className="text-[10px] font-mono text-sentinel-muted tracking-wider block mb-1">ORACLE CONTRACT</span>
                <a
                  href="https://sepolia.etherscan.io/address/0x155a5d68f2278d4a9398184871c9b8f62277c857"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs text-sentinel-blue hover:underline"
                >
                  0x155a...c857
                </a>
              </div>
              <div>
                <span className="text-[10px] font-mono text-sentinel-muted tracking-wider block mb-1">WORST SOLVENCY</span>
                <span className="font-mono text-xs text-sentinel-text">
                  {latest.aggregate.worstProtocol || 'N/A'} — {latest.aggregate.worstSolvency}%
                </span>
              </div>
              <div>
                <span className="text-[10px] font-mono text-sentinel-muted tracking-wider block mb-1">DATA SOURCES</span>
                <span className="font-mono text-xs text-sentinel-text">
                  {latest.protocols.length} onchain + {latest.offchain.length} offchain
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* ── Capabilities ────────────────────────────── */}
        <section className="mb-8 animate-slide-up" style={{ animationDelay: '700ms' }}>
          <div className="flex items-center gap-3 mb-4">
            <span className="text-[10px] font-mono text-sentinel-muted tracking-[0.2em]">CRE CAPABILITIES</span>
            <div className="flex-1 h-px bg-sentinel-border" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            {[
              { name: 'Cron Trigger', icon: '⏰' },
              { name: 'EVM Read', icon: '📖' },
              { name: 'HTTP GET', icon: '🌐' },
              { name: 'Consensus', icon: '🤝' },
              { name: 'EVM Write', icon: '✍️' },
              { name: 'DON Time', icon: '🕐' },
              { name: 'HTTP POST', icon: '📤' },
            ].map((cap, i) => (
              <div key={cap.name}
                className="bg-sentinel-card border border-sentinel-border rounded-lg px-3 py-3 text-center card-hover"
                style={{ animationDelay: `${700 + i * 50}ms` }}>
                <span className="text-lg block mb-1">{cap.icon}</span>
                <span className="text-[10px] font-mono text-sentinel-muted tracking-wider">{cap.name}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ── Footer ──────────────────────────────────── */}
        <footer className="border-t border-sentinel-border pt-6 pb-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-sentinel-muted">
                Powered by
              </span>
              <span className="text-xs font-mono text-sentinel-accent font-bold">
                Chainlink CRE
              </span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-[10px] font-mono text-sentinel-muted">
                Auto-refresh every 15s
              </span>
              <div className="w-1.5 h-1.5 rounded-full bg-sentinel-accent animate-pulse" />
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}