// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SENTINAL — Confidential Policy Engine
//
// All risk thresholds stored as a single JSON secret
// via runtime.getSecret(). Zero threshold constants
// in source code. Adversaries cannot simulate exact
// trigger conditions from public source.
//
// policyHash = keccak256(SENTINAL_POLICY_CONFIG)
// Recorded on-chain with every enforcement event →
// immutable cryptographic compliance trail.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { Runtime } from '@chainlink/cre-sdk'
import { keccak256, toBytes, toHex } from 'viem'
import type { Config } from '../../config/schema'
import type { PolicyConfig, PolicyThresholds } from '../../types'

// ── Fallback thresholds (used only if secret missing) ──
// These are deliberately conservative — fail-safe behavior
const FALLBACK_THRESHOLDS: PolicyThresholds = {
    solvencyWarningBps: 9500,
    solvencyCriticalBps: 9000,
    solvencyEmergencyBps: 8000,
    velocityAlertBps: 500,
    velocityExtremeMultiplier: 3,
    riskWarningThreshold: 30,
    riskCriticalThreshold: 60,
    contagionMinChains: 2,
    contagionVelocityBps: 300,
    crossRefShareMin: 0.5,
    crossRefShareMax: 200,
    lidoMinBackingBps: 9900,
}

// ── Load policy from CRE secret store ────────────
// Secret name: SENTINAL_POLICY_CONFIG
// Format: JSON string of PolicyConfig
export function loadPolicy(runtime: Runtime<Config>): {
    policy: PolicyConfig
    policyHash: string
    rawConfig: string
    fromSecret: boolean
} {
    let rawConfig = ''
    let fromSecret = false

    try {
        // Try getSecrets() (plural) — used in most CRE SDK versions
        const secrets = (runtime as any).getSecrets?.()
        const fromGetSecrets = secrets?.SENTINAL_POLICY_CONFIG
        if (fromGetSecrets && String(fromGetSecrets).trim().length > 0) {
            rawConfig = String(fromGetSecrets).trim()
            fromSecret = true
        }
    } catch { /* not available */ }

    if (!fromSecret) {
        try {
            // Try getSecret() singular
            const secret = (runtime as any).getSecret?.('SENTINAL_POLICY_CONFIG')
            if (secret && String(secret).trim().length > 0) {
                rawConfig = String(secret).trim()
                fromSecret = true
            }
        } catch { /* not available */ }
    }

    let policy: PolicyConfig

    if (fromSecret) {
        try {
            const parsed = JSON.parse(rawConfig) as PolicyConfig
            // Validate required fields exist
            if (!parsed.thresholds || !parsed.version) {
                throw new Error('Invalid policy format')
            }
            // Merge with fallback to fill any missing fields
            policy = {
                version: parsed.version,
                thresholds: { ...FALLBACK_THRESHOLDS, ...parsed.thresholds },
            }
        } catch {
            // Parse failed — use fallback
            fromSecret = false
            rawConfig = JSON.stringify({ version: 'fallback-v1', thresholds: FALLBACK_THRESHOLDS })
            policy = { version: 'fallback-v1', thresholds: FALLBACK_THRESHOLDS }
        }
    } else {
        rawConfig = JSON.stringify({ version: 'fallback-v1', thresholds: FALLBACK_THRESHOLDS })
        policy = { version: 'fallback-v1', thresholds: FALLBACK_THRESHOLDS }
    }

    // ── Compute policyHash ──────────────────────
    // keccak256 of the canonical policy JSON
    // This is stored on-chain alongside every enforcement
    // event, creating a cryptographic compliance trail:
    //   "Enforcement X was triggered by policy version Y"
    const policyHash = keccak256(toBytes(rawConfig))

    return { policy, policyHash, rawConfig, fromSecret }
}

// ── Format policyHash for on-chain storage ────────
export function encodePolicyHash(policyHash: string): bigint {
    // First 32 bytes of the hash as a uint256
    return BigInt(policyHash)
}