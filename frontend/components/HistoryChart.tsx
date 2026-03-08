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

    const getAvgUtil = (h: HealthCheck) => {
        const utils = h.protocols.map(p => p.utilizationBps ?? 0).filter(v => v > 0);
        return utils.length ? utils.reduce((a, b) => a + b, 0) / utils.length : 0;
    };

    const maxUtil = Math.max(...history.map(h => getAvgUtil(h)), 1000);
    const chartHeight = 160;

    return (
        <div className="relative">
            {/* Y-axis labels */}
            <div className="absolute left-0 top-0 bottom-8 flex flex-col justify-between text-[10px] font-mono text-sentinel-muted w-8">
                <span>{(maxUtil / 100).toFixed(0)}%</span>
                <span>{(maxUtil / 200).toFixed(0)}%</span>
                <span>0%</span>
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
                        const score = getAvgUtil(check);
                        const height = maxUtil > 0 ? (score / maxUtil) * 100 : 0;
                        const color = score < 5000 ? '#00D4AA' : score < 7000 ? '#F59E0B' : '#FF4560';
                        const minHeight = Math.max(height, 5);

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
                                            Avg Util: {(score / 100).toFixed(1)}%
                                        </div>
                                        <div className="font-mono text-[10px] text-sentinel-muted">
                                            {check.protocols.length} protocols
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