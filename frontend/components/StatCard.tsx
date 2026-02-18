'use client';

import { ReactNode } from 'react';

interface StatCardProps {
    label: string;
    value: string | number;
    icon: ReactNode;
    subtitle?: string;
    color?: string;
    delay?: number;
}

export function StatCard({ label, value, icon, subtitle, color = '#00E676', delay = 0 }: StatCardProps) {
    return (
        <div
            className="bg-sentinel-card border border-sentinel-border rounded-xl p-5 animate-slide-up card-hover"
            style={{ animationDelay: `${delay}ms` }}
        >
            <div className="flex items-start justify-between mb-3">
                <span className="text-[10px] font-mono text-sentinel-muted tracking-[0.2em] uppercase">{label}</span>
                <div className="text-sentinel-muted">{icon}</div>
            </div>
            <div className="font-mono font-bold text-2xl" style={{ color }}>
                {value}
            </div>
            {subtitle && (
                <span className="text-xs text-sentinel-muted mt-1 block">{subtitle}</span>
            )}
        </div>
    );
}