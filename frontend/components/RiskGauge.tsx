'use client';

export function RiskGauge({ score }: { score: number }) {
  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / 100) * circumference;
  const color = score < 30 ? '#00E676' : score < 60 ? '#FFD600' : '#FF1744';

  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        <svg width="180" height="180" viewBox="0 0 180 180">
          {/* Background circle */}
          <circle cx="90" cy="90" r={radius} fill="none"
            stroke="#1E293B" strokeWidth="8" />
          {/* Progress arc */}
          <circle cx="90" cy="90" r={radius} fill="none"
            stroke={color} strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference - progress}
            transform="rotate(-90 90 90)"
            style={{
              transition: 'stroke-dashoffset 1s ease-out, stroke 0.5s ease',
              filter: `drop-shadow(0 0 8px ${color}50)`,
            }}
          />
          {/* Center text */}
          <text x="90" y="82" textAnchor="middle"
            className="font-mono font-bold" fontSize="36" fill={color}>
            {score}
          </text>
          <text x="90" y="105" textAnchor="middle"
            className="font-mono" fontSize="12" fill="#64748B">
            / 100
          </text>
        </svg>
      </div>
      <span className="text-sentinel-muted text-xs font-mono mt-1 tracking-wider">RISK SCORE</span>
    </div>
  );
}