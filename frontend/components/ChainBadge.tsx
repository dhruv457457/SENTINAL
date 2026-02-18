'use client';

import { getChainLabel, getChainColor } from '@/lib/api';

export function ChainBadge({ chain }: { chain: string }) {
    const color = getChainColor(chain);
    const label = getChainLabel(chain);

    return (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border"
            style={{ borderColor: `${color}30`, background: `${color}08` }}>
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
            <span className="font-mono text-xs" style={{ color }}>{label}</span>
        </div>
    );
}