'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  HealthCheck, GuardStatus,
  fetchLatest, fetchHistory, fetchGuardStatus,
  formatUSD, ORACLE_ADDRESS, GUARD_ADDRESS, CONTROLLER_ADDRESS,
} from '@/lib/api';
import { Header } from '@/components/Header';
import { StatusBadge } from '@/components/StatusBadge';
import { RiskGauge } from '@/components/RiskGauge';
import { ProtocolCard } from '@/components/ProtocolCard';
import { StatCard } from '@/components/StatCard';
import { HistoryChart } from '@/components/HistoryChart';
import { ChainBadge } from '@/components/ChainBadge';
import { GuardPanel } from '@/components/GuardPanel';
import { VaultCard } from '@/components/VaultCard';

// ── Icons ──────────────────────────────────────
const ShieldIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);
const LayersIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polygon points="12 2 2 7 12 12 22 7 12 2" />
    <polyline points="2 17 12 22 22 17" />
    <polyline points="2 12 12 17 22 12" />
  </svg>
);
const LinkIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);
const DollarIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="12" y1="1" x2="12" y2="23" />
    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </svg>
);
const GlobeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);
const AlertIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);
const ActivityIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
);
const ZapIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);
const MonitorIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
  </svg>
);
const GuardTabIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

const POLL_INTERVAL = 15_000;
type Tab = 'monitor' | 'guard';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DASHBOARD
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export default function Dashboard() {
  const [latest, setLatest] = useState<HealthCheck | null>(null);
  const [history, setHistory] = useState<HealthCheck[]>([]);
  const [guard, setGuard] = useState<GuardStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('monitor');

  const loadData = useCallback(async () => {
    try {
      const [latestData, historyData, guardData] = await Promise.all([
        fetchLatest(),
        fetchHistory(),
        fetchGuardStatus(),
      ]);
      if (latestData) setLatest(latestData);
      if (historyData) setHistory(historyData);
      if (guardData) setGuard(guardData);
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

  // ── Loading ─────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen grid-bg flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-sentinel-accent/10 border border-sentinel-accent/30 flex items-center justify-center animate-pulse">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#00D4AA" strokeWidth="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </div>
          <p className="font-mono text-sentinel-muted text-sm tracking-wider">INITIALIZING SENTINAL...</p>
        </div>
      </div>
    );
  }

  // ── No data ─────────────────────────────────
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
  const velocityAlerts = latest.velocityAlerts ?? [];
  const isFirstRun = latest.isFirstRun ?? false;
  const guardPaused = guard?.globalPaused ?? false;
  const totalVelocityAlertsInHistory = history.filter(h =>
    (h.velocityAlerts?.length ?? 0) > 0
  ).length;

  return (
    <div className="min-h-screen grid-bg">
      <Header
        lastUpdated={latest.receivedAt || lastFetch?.toISOString()}
        checkNumber={latest.checkNumber}
        isFirstRun={isFirstRun}
        guardPaused={guardPaused}
      />

      {/* ── Tab Bar ─────────────────────────────── */}
      <div className="sticky top-[65px] z-30 border-b border-sentinel-border bg-sentinel-bg/80 backdrop-blur-sm">
        <div className="max-w-[1440px] mx-auto px-6">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setActiveTab('monitor')}
              className={`flex items-center gap-2 px-4 py-3 text-xs font-mono tracking-wider border-b-2 transition-all ${
                activeTab === 'monitor'
                  ? 'border-sentinel-accent text-sentinel-accent'
                  : 'border-transparent text-sentinel-muted hover:text-sentinel-text hover:border-sentinel-border'
              }`}
            >
              <MonitorIcon />
              MONITOR
            </button>
            <button
              onClick={() => setActiveTab('guard')}
              className={`flex items-center gap-2 px-4 py-3 text-xs font-mono tracking-wider border-b-2 transition-all relative ${
                activeTab === 'guard'
                  ? 'border-sentinel-accent text-sentinel-accent'
                  : 'border-transparent text-sentinel-muted hover:text-sentinel-text hover:border-sentinel-border'
              }`}
            >
              <GuardTabIcon />
              GUARD &amp; VAULT
              {guardPaused && (
                <span className="ml-1 w-1.5 h-1.5 rounded-full bg-sentinel-critical animate-pulse inline-block" />
              )}
              {!guardPaused && velocityAlerts.length > 0 && (
                <span className="ml-1 w-1.5 h-1.5 rounded-full bg-sentinel-yellow animate-pulse inline-block" />
              )}
            </button>
          </div>
        </div>
      </div>

      <main className="max-w-[1440px] mx-auto px-6 py-8">

        {/* ════════════════════════════════════════
            TAB: MONITOR
            ════════════════════════════════════════ */}
        {activeTab === 'monitor' && (
          <>
            {/* ── Hero ─────────────────────────────── */}
            <section className="mb-10 animate-fade-in">
              <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
                <div>
                  <div className="flex items-center gap-3 mb-3 flex-wrap">
                    <StatusBadge severity={latest.severity} />
                    {latest.anomalyDetected && (
                      <span className="px-3 py-1 rounded-full border border-sentinel-critical/30 bg-sentinel-critical/10 text-sentinel-critical text-xs font-mono">
                        ⚠ ANOMALY DETECTED
                      </span>
                    )}
                    {guardPaused && (
                      <span className="px-3 py-1 rounded-full border border-sentinel-critical/40 bg-sentinel-critical/10 text-sentinel-critical text-xs font-mono animate-pulse">
                        🛡️ CIRCUIT BREAKER ACTIVE
                      </span>
                    )}
                    {isFirstRun && (
                      <span className="px-3 py-1 rounded-full border border-blue-500/30 bg-blue-500/10 text-blue-400 text-xs font-mono">
                        📌 SEEDING BASELINE
                      </span>
                    )}
                  </div>
                  <p className="text-sentinel-muted text-sm font-body max-w-lg">
                    Monitoring {latest.protocols.length} protocols across {latest.chains.length} chains
                    with {formatUSD(latest.aggregate.totalActualUSD)} in aggregate reserves.
                    Powered by Chainlink CRE · DON-signed reports · SentinalGuard circuit breaker.
                  </p>
                </div>
                <RiskGauge score={latest.riskScore} />
              </div>
            </section>

            {/* ── Chain Coverage ─────────────────────── */}
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

            {/* ── Key Metrics ────────────────────────── */}
            <section className="mb-8">
              <div className="flex items-center gap-3 mb-4">
                <span className="text-[10px] font-mono text-sentinel-muted tracking-[0.2em]">KEY METRICS</span>
                <div className="flex-1 h-px bg-sentinel-border" />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
                <StatCard label="Reserves" value={formatUSD(latest.aggregate.totalActualUSD)} icon={<DollarIcon />} color="#00D4AA" delay={50} />
                <StatCard label="Protocols" value={latest.protocols.length} icon={<LayersIcon />} color="#3B82F6" delay={100} />
                <StatCard label="Chains" value={latest.chains.length} icon={<LinkIcon />} color="#8B5CF6" delay={150} />
                <StatCard label="Total TVL" value={formatUSD(totalTVL)} icon={<GlobeIcon />} color="#06B6D4" delay={200} subtitle="DeFiLlama" />
                <StatCard label="Checks" value={history.length} icon={<ShieldIcon />} color="#F59E0B" delay={250} />
                <StatCard label="Anomalies" value={history.filter(h => h.anomalyDetected).length} icon={<AlertIcon />} color={history.some(h => h.anomalyDetected) ? '#FF4560' : '#64748B'} delay={300} />
                <StatCard label="⚡ Vel Alerts" value={totalVelocityAlertsInHistory} icon={<ZapIcon />} color={totalVelocityAlertsInHistory > 0 ? '#FF4560' : '#64748B'} delay={350} />
                <StatCard label="Registered" value={guard?.registered ?? '—'} icon={<ShieldIcon />} color="#00D4AA" delay={400} subtitle="on guard" />
              </div>
            </section>

            {/* ── Protocol Grid ──────────────────────── */}
            <section className="mb-8">
              <div className="flex items-center gap-3 mb-4">
                <span className="text-[10px] font-mono text-sentinel-muted tracking-[0.2em]">PROTOCOL SOLVENCY</span>
                <div className="flex-1 h-px bg-sentinel-border" />
                {!isFirstRun && velocityAlerts.length > 0 && (
                  <span className="text-[10px] font-mono text-sentinel-critical">
                    ⚡ {velocityAlerts.length} velocity spike{velocityAlerts.length > 1 ? 's' : ''} detected
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {latest.protocols.map((protocol, i) => (
                  <ProtocolCard key={protocol.name} protocol={protocol} delay={i * 80} />
                ))}
              </div>
            </section>

            {/* ── History Chart ───────────────────────── */}
            <section className="mb-8">
              <div className="bg-sentinel-card border border-sentinel-border rounded-xl p-6 animate-slide-up"
                style={{ animationDelay: '400ms' }}>
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <ActivityIcon />
                    <span className="text-[10px] font-mono text-sentinel-muted tracking-[0.2em]">AVG UTILIZATION</span>
                  </div>
                  <span className="text-xs font-mono text-sentinel-muted">
                    Last {Math.min(history.length, 30)} checks
                  </span>
                </div>
                <HistoryChart history={history} />
              </div>
            </section>

            {/* ── Offchain TVL ────────────────────────── */}
            <section className="mb-8 animate-slide-up" style={{ animationDelay: '500ms' }}>
              <div className="bg-sentinel-card border border-sentinel-border rounded-xl p-6">
                <div className="flex items-center gap-3 mb-5">
                  <GlobeIcon />
                  <span className="text-[10px] font-mono text-sentinel-muted tracking-[0.2em]">OFFCHAIN TVL — DEFI LLAMA</span>
                  <div className="flex-1 h-px bg-sentinel-border" />
                  <span className="text-[10px] font-mono text-sentinel-muted">DON consensus median</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {latest.offchain.map(o => (
                    <div key={o.slug} className="flex items-center justify-between p-4 rounded-lg bg-sentinel-bg border border-sentinel-border">
                      <div>
                        <span className="font-mono text-sm text-sentinel-text capitalize">{o.slug}</span>
                        <span className="block text-[10px] font-mono text-sentinel-muted mt-0.5">
                          Cross-referenced against onchain data
                        </span>
                      </div>
                      <span className="font-mono font-bold text-xl text-sentinel-accent">
                        {formatUSD(o.tvl)}
                      </span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between p-4 rounded-lg bg-sentinel-accent/5 border border-sentinel-accent/20 md:col-span-2">
                    <span className="text-[10px] font-mono text-sentinel-muted tracking-wider">TOTAL TVL MONITORED</span>
                    <span className="font-mono font-bold text-2xl text-sentinel-accent">
                      {formatUSD(totalTVL)}
                    </span>
                  </div>
                </div>
              </div>
            </section>

            {/* ── Latest Onchain Report ────────────────── */}
            <section className="mb-8 animate-slide-up" style={{ animationDelay: '600ms' }}>
              <div className="bg-sentinel-card border border-sentinel-border rounded-xl p-6">
                <div className="flex items-center gap-3 mb-5">
                  <span className="text-[10px] font-mono text-sentinel-muted tracking-[0.2em]">LATEST ONCHAIN REPORT</span>
                  <div className="flex-1 h-px bg-sentinel-border" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                  <div>
                    <span className="text-[10px] font-mono text-sentinel-muted tracking-wider block mb-1">TX HASH</span>
                    {latest.txHash && !latest.txHash.startsWith('0x000000') ? (
                      <a href={`https://sepolia.etherscan.io/tx/${latest.txHash}`}
                        target="_blank" rel="noopener noreferrer"
                        className="font-mono text-xs text-sentinel-accent hover:underline">
                        {latest.txHash.slice(0, 10)}...{latest.txHash.slice(-8)}
                      </a>
                    ) : (
                      <span className="font-mono text-xs text-sentinel-muted">Simulation mode</span>
                    )}
                  </div>
                  <div>
                    <span className="text-[10px] font-mono text-sentinel-muted tracking-wider block mb-1">ORACLE</span>
                    <a href={`https://sepolia.etherscan.io/address/${ORACLE_ADDRESS}`}
                      target="_blank" rel="noopener noreferrer"
                      className="font-mono text-xs text-sentinel-blue hover:underline">
                      {ORACLE_ADDRESS.slice(0, 10)}...{ORACLE_ADDRESS.slice(-6)}
                    </a>
                  </div>
                  <div>
                    <span className="text-[10px] font-mono text-sentinel-muted tracking-wider block mb-1">GUARD</span>
                    <a href={`https://sepolia.etherscan.io/address/${GUARD_ADDRESS}`}
                      target="_blank" rel="noopener noreferrer"
                      className="font-mono text-xs text-sentinel-blue hover:underline">
                      {GUARD_ADDRESS.slice(0, 10)}...{GUARD_ADDRESS.slice(-6)}
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
                      {latest.protocols.length} onchain · {latest.offchain.length} offchain · 1 oracle
                    </span>
                  </div>
                </div>
              </div>
            </section>

            {/* ── CRE Capabilities ────────────────────── */}
            <section className="mb-8 animate-slide-up" style={{ animationDelay: '700ms' }}>
              <div className="flex items-center gap-3 mb-4">
                <span className="text-[10px] font-mono text-sentinel-muted tracking-[0.2em]">CHAINLINK CRE CAPABILITIES USED</span>
                <div className="flex-1 h-px bg-sentinel-border" />
                <span className="text-[10px] font-mono text-sentinel-muted">15/15 EVM calls</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
                {[
                  { name: 'Cron Trigger', icon: '⏰', note: 'every 60s' },
                  { name: 'EVM Read', icon: '📖', note: 'calls 1–14' },
                  { name: 'HTTP GET', icon: '🌐', note: 'DeFiLlama' },
                  { name: 'DON Consensus', icon: '🤝', note: 'median TVL' },
                  { name: 'EVM Write', icon: '✍️', note: 'DON-signed' },
                  { name: 'DON Time', icon: '🕐', note: 'timestamp' },
                  { name: 'HTTP POST', icon: '📤', note: 'Discord' },
                ].map((cap, i) => (
                  <div key={cap.name}
                    className="bg-sentinel-card border border-sentinel-border rounded-lg px-3 py-3 text-center card-hover"
                    style={{ animationDelay: `${700 + i * 50}ms` }}>
                    <span className="text-lg block mb-1">{cap.icon}</span>
                    <span className="text-[10px] font-mono text-sentinel-muted tracking-wider block">{cap.name}</span>
                    <span className="text-[9px] font-mono text-sentinel-muted/60">{cap.note}</span>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}

        {/* ════════════════════════════════════════
            TAB: GUARD & VAULT
            ════════════════════════════════════════ */}
        {activeTab === 'guard' && (
          <div className="animate-fade-in">
            {/* Status banner if paused */}
            {guardPaused && (
              <div className="mb-6 p-4 rounded-xl border border-sentinel-critical/40 bg-sentinel-critical/5 flex items-center gap-3">
                <span className="w-3 h-3 rounded-full bg-sentinel-critical animate-pulse flex-shrink-0" />
                <div>
                  <span className="font-mono font-bold text-sm text-sentinel-critical">CIRCUIT BREAKER ACTIVE</span>
                  <span className="font-mono text-xs text-sentinel-muted block mt-0.5">
                    All registered vaults are currently blocking transactions. SentinalGuard is protecting funds.
                  </span>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <GuardPanel
                status={guard}
                velocityAlerts={velocityAlerts}
                isFirstRun={isFirstRun}
              />
              <VaultCard guardPaused={guardPaused} />
            </div>

            {/* Integration callout */}
            <div className="mt-6 p-6 rounded-xl border border-sentinel-border bg-sentinel-card animate-slide-up" style={{ animationDelay: '200ms' }}>
              <div className="flex items-center gap-3 mb-4">
                <span className="text-[10px] font-mono text-sentinel-muted tracking-[0.2em]">HOW SENTINALGUARD WORKS</span>
                <div className="flex-1 h-px bg-sentinel-border" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  { step: '01', title: 'CRE Monitors', desc: 'Chainlink CRE runs every 60s reading 15 onchain data points across 4 protocols and 3 chains.' },
                  { step: '02', title: 'Oracle Reports', desc: 'DON-signed report submitted onchain. If solvency drops or velocity spikes, Guard is triggered.' },
                  { step: '03', title: 'Vault Protected', desc: 'Any vault calling guard.isSafe() is instantly blocked during a circuit-breaker event.' },
                ].map(({ step, title, desc }) => (
                  <div key={step} className="flex gap-4">
                    <span className="font-mono font-bold text-2xl text-sentinel-accent/30 flex-shrink-0 leading-none">{step}</span>
                    <div>
                      <span className="font-mono font-bold text-sm text-sentinel-text block mb-1">{title}</span>
                      <span className="text-xs text-sentinel-muted font-body leading-relaxed">{desc}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Footer ──────────────────────────────── */}
        <footer className="border-t border-sentinel-border pt-6 pb-10 mt-4">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <span className="text-xs font-mono text-sentinel-muted">Powered by</span>
              <span className="text-xs font-mono text-sentinel-accent font-bold">Chainlink CRE</span>
              <span className="text-sentinel-border">·</span>
              <span className="text-xs font-mono text-sentinel-muted">Protected by</span>
              <span className="text-xs font-mono font-bold" style={{ color: '#00D4AA' }}>SentinalGuard</span>
            </div>
            <div className="flex items-center gap-4">
              <a href="https://discord.gg/Wq8arAHf"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[#5865F2]/40 bg-[#5865F2]/10 hover:bg-[#5865F2]/20 transition-colors group"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="#5865F2">
                  <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z" />
                </svg>
                <span className="text-xs font-mono text-[#5865F2] group-hover:text-[#7289DA] transition-colors">
                  Join for Risk Alerts
                </span>
              </a>
              <span className="text-[10px] font-mono text-sentinel-muted">Auto-refresh 15s</span>
              <div className="w-1.5 h-1.5 rounded-full bg-sentinel-accent animate-pulse" />
            </div>
          </div>
        </footer>

      </main>
    </div>
  );
}