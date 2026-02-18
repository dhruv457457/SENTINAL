'use client';

import { getSeverityColor } from '@/lib/api';

export function StatusBadge({ severity }: { severity: string }) {
    const color = getSeverityColor(severity);
    const glowClass = severity === 'HEALTHY' ? 'glow-green' : severity === 'WARNING' ? 'glow-yellow' : 'glow-red';

    return (
        <div className={`inline-flex items-center gap-3 px-5 py-2.5 rounded-full border ${glowClass}`}
            style={{ borderColor: `${color}40`, background: `${color}10` }}>
            <span className="status-dot relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping"
                    style={{ backgroundColor: color }} />
                <span className="relative inline-flex rounded-full h-3 w-3"
                    style={{ backgroundColor: color }} />
            </span>
            <span className="font-mono font-bold text-sm tracking-widest"
                style={{ color }}>
                {severity}
            </span>
        </div>
    );
}