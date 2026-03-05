// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SENTINAL — Shared Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface ProtocolResult {
    name: string
    type: string
    chain: string
    claimed: bigint
    actual: bigint
    solvencyRatio: number
    utilizationBps: number
    details: string
}

export interface VelocityResult {
    name: string
    currentUtilBps: number
    prevUtilBps: number
    velocityBps: number
    velocityNegative: boolean
    isAlert: boolean
}

export interface ContagionResult {
    detected: boolean
    affectedChains: string[]
    affectedProtocols: string[]
    correlatedVelocity: number   // avg velocity across affected protocols
    tierEscalation: number       // extra risk score added
    description: string
}

export interface PolicyThresholds {
    // Solvency
    solvencyWarningBps: number    // default: 9500 (95%)
    solvencyCriticalBps: number   // default: 9000 (90%)
    solvencyEmergencyBps: number  // default: 8000 (80%)

    // Velocity
    velocityAlertBps: number      // default: 500  (5%/cycle)
    velocityExtremeMultiplier: number // default: 3x

    // Risk score thresholds
    riskWarningThreshold: number  // default: 30
    riskCriticalThreshold: number // default: 60

    // Contagion
    contagionMinChains: number    // default: 2 (min chains to trigger contagion)
    contagionVelocityBps: number  // default: 300 (3%/cycle on multiple chains)

    // Cross-ref
    crossRefShareMin: number      // default: 0.5 (%)
    crossRefShareMax: number      // default: 200 (%)
    lidoMinBackingBps: number     // default: 9900 (99%)
}

export interface PolicyConfig {
    version: string
    thresholds: PolicyThresholds
}

export interface AttestationRecord {
    runId: string
    policyHash: string
    policyVersion: string
    severity: number
    riskScore: number
    timestamp: bigint
}

export type Severity = 0 | 1 | 2 // HEALTHY | WARNING | CRITICAL
export type SeverityText = 'HEALTHY' | 'WARNING' | 'CRITICAL'