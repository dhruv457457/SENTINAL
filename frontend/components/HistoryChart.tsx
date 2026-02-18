'use client';

import { HealthCheck } from '@/lib/api';

export function HistoryChart({ history }: { history: HealthCheck[] }) {
    if (history.length === 0) {
        return (
            <div className="flex items-center justify-center h-40 text-sentinel-muted font-mono text-sm">
                No history data yet
            </div>
        );
    }

    const maxRisk = Math.max(...history.map(h => h.riskScore), 10);
    const chartHeight = 160;
    const chartWidth = 100; // percentage

    return (
        <div className="relative">
            {/* Y-axis labels */}
            <div className="absolute left-0 top-0 bottom-8 flex flex-col justify-between text-[10px] font-mono text-sentinel-muted w-8">
                <span>{maxRisk}</span>
                <span>{Math.floor(maxRisk / 2)}</span>
                <span>0</span>
            </div>

            {/* Chart area */}
            <div className="ml-10 relative" style={{ height: chartHeight }}>
                {/* Grid lines */}
                <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
                    {[0, 1, 2].map(i => (
                        <div key={i} className="w-full h-px bg-sentinel-border" />
                    ))}
                </div>

                {/* Bars */}
                <div className="absolute inset-0 flex items-end gap-1 px-1">
                    {history.slice(-30).map((check, i) => {
                        const height = maxRisk > 0 ? (check.riskScore / maxRisk) * 100 : 0;
                        const color = check.riskScore < 30 ? '#00E676' : check.riskScore < 60 ? '#FFD600' : '#FF1744';
                        const minHeight = check.riskScore === 0 ? 3 : Math.max(height, 3);

                        return (
                            <div
                                key={i}
                                className="flex-1 rounded-t transition-all duration-500 group relative cursor-pointer"
                                style={{
                                    height: `${minHeight}%`,
                                    backgroundColor: `${color}80`,
                                    minWidth: '4px',
                                    animationDelay: `${i * 30}ms`,
                                }}
                            >
                                {/* Tooltip */}
                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-10">
                                    <div className="bg-sentinel-card border border-sentinel-border rounded-lg px-3 py-2 whitespace-nowrap shadow-xl">
                                        <div className="font-mono text-xs text-sentinel-text">Check #{check.checkNumber}</div>
                                        <div className="font-mono text-xs" style={{ color }}>
                                            Risk: {check.riskScore}/100
                                        </div>
                                        <div className="font-mono text-[10px] text-sentinel-muted">
                                            {check.severity}
                                        </div>
                                    </div>
                                </div>

                                <div className="absolute inset-0 rounded-t opacity-0 group-hover:opacity-100 transition-opacity"
                                    style={{ backgroundColor: color, boxShadow: `0 0 12px ${color}60` }} />
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* X-axis */}
            <div className="ml-10 flex justify-between mt-2 text-[10px] font-mono text-sentinel-muted">
                <span>#{history[Math.max(0, history.length - 30)]?.checkNumber || 1}</span>
                <span>Latest #{history[history.length - 1]?.checkNumber}</span>
            </div>
        </div>
    );
}