// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SENTINAL — Cross-Chain Contagion Detection
//
// Detects correlated stress signals across multiple
// chains simultaneously. A velocity spike on a single
// chain is a local event. The same spike appearing on
// Ethereum + Arbitrum + Base simultaneously is a
// contagion signal — systemic risk, not local.
//
// No extra EVM calls needed — pure analysis on data
// already collected in Steps 1-4.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { ProtocolResult, VelocityResult, ContagionResult, PolicyThresholds } from '../../types'

export function detectContagion(
	results: ProtocolResult[],
	velocities: VelocityResult[],
	isFirstRun: boolean,
	thresholds: PolicyThresholds
): ContagionResult {
	if (isFirstRun) {
		return {
			detected: false,
			affectedChains: [],
			affectedProtocols: [],
			correlatedVelocity: 0,
			tierEscalation: 0,
			description: 'First run — no baseline for contagion detection',
		}
	}

	// ── Signal 1: Velocity contagion ─────────────
	// Multiple chains showing velocity alerts simultaneously
	const velocityAlerts = velocities.filter(
		v => v.velocityBps >= thresholds.contagionVelocityBps && !v.velocityNegative
	)

	const alertChains = [...new Set(
		velocityAlerts.map(v => {
			const protocol = results.find(r => r.name === v.name)
			return protocol?.chain ?? ''
		}).filter(Boolean)
	)]

	// ── Signal 2: Solvency contagion ─────────────
	// Multiple chains showing solvency degradation simultaneously
	const solvencyAlerts = results.filter(
		r => r.solvencyRatio < thresholds.solvencyWarningBps
	)

	const solvencyChains = [...new Set(solvencyAlerts.map(r => r.chain))]

	// ── Combine signals ───────────────────────────
	const allAffectedChains = [...new Set([...alertChains, ...solvencyChains])]
	const allAffectedProtocols = [
		...velocityAlerts.map(v => v.name),
		...solvencyAlerts.map(r => r.name),
	].filter((v, i, a) => a.indexOf(v) === i)

	const contagionDetected = allAffectedChains.length >= thresholds.contagionMinChains

	if (!contagionDetected) {
		return {
			detected: false,
			affectedChains: [],
			affectedProtocols: [],
			correlatedVelocity: 0,
			tierEscalation: 0,
			description: 'No cross-chain contagion detected',
		}
	}

	// ── Calculate correlated velocity ────────────
	const avgVelocity = velocityAlerts.length > 0
		? velocityAlerts.reduce((sum, v) => sum + v.velocityBps, 0) / velocityAlerts.length
		: 0

	// ── Tier escalation ───────────────────────────
	// Contagion on 2 chains: +15 risk
	// Contagion on 3+ chains: +25 risk
	const tierEscalation = allAffectedChains.length >= 3 ? 25 : 15

	const description = `Contagion detected across ${allAffectedChains.length} chains: ${allAffectedChains.join(', ')} — ${allAffectedProtocols.join(', ')}`

	return {
		detected: true,
		affectedChains: allAffectedChains,
		affectedProtocols: allAffectedProtocols,
		correlatedVelocity: Math.round(avgVelocity),
		tierEscalation,
		description,
	}
}