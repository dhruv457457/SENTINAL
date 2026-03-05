// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SENTINAL — Risk Scoring Engine
// All thresholds sourced from confidential policy.
// Zero hardcoded constants — adversaries cannot
// simulate exact trigger conditions.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type {
	ProtocolResult,
	VelocityResult,
	ContagionResult,
	PolicyThresholds,
	Severity,
	SeverityText,
} from '../../types'

interface RiskScoreResult {
	riskScore: number
	worstSolvency: number
	worstProtocol: string
	severity: Severity
	statusText: SeverityText
	anomalyDetected: boolean
}

export function calculateRiskScore(
	results: ProtocolResult[],
	velocities: VelocityResult[],
	contagion: ContagionResult,
	crossRefRisk: number,
	isFirstRun: boolean,
	thresholds: PolicyThresholds
): RiskScoreResult {
	let riskScore = 0
	let worstSolvency = Infinity
let worstProtocol = results.length > 0 ? results[0].name : ''

	// ── Solvency scoring ──────────────────────────
	for (const result of results) {
		if (result.solvencyRatio < worstSolvency) {
			worstSolvency = result.solvencyRatio
			worstProtocol = result.name
		}
		if (result.solvencyRatio < thresholds.solvencyWarningBps)  riskScore += 15
		if (result.solvencyRatio < thresholds.solvencyCriticalBps) riskScore += 10
		if (result.solvencyRatio < thresholds.solvencyEmergencyBps) riskScore += 10
	}

	// ── Velocity scoring ──────────────────────────
	if (!isFirstRun) {
		for (const v of velocities) {
			if (v.velocityBps >= thresholds.velocityAlertBps && !v.velocityNegative) {
				riskScore += 15
				if (v.velocityBps >= thresholds.velocityAlertBps * thresholds.velocityExtremeMultiplier) {
					riskScore += 20
				}
			} else if (v.velocityBps >= thresholds.velocityAlertBps && v.velocityNegative) {
				riskScore += 10
			}
		}
	}

	// ── Contagion escalation ──────────────────────
	if (contagion.detected) {
		riskScore += contagion.tierEscalation
	}

	// ── Cross-reference risk ──────────────────────
	riskScore += crossRefRisk

	if (riskScore > 100) riskScore = 100

	// ── Severity classification ───────────────────
	const anomalyDetected = crossRefRisk > 0
		|| worstSolvency < thresholds.solvencyWarningBps
		|| (!isFirstRun && velocities.some(v => v.isAlert))
		|| contagion.detected

	let severity: Severity
	let statusText: SeverityText

	if (riskScore < thresholds.riskWarningThreshold && worstSolvency >= thresholds.solvencyWarningBps) {
		severity = 0
		statusText = 'HEALTHY'
	} else if (riskScore < thresholds.riskCriticalThreshold && worstSolvency >= thresholds.solvencyCriticalBps) {
		severity = 1
		statusText = 'WARNING'
	} else {
		severity = 2
		statusText = 'CRITICAL'
	}

	return { riskScore, worstSolvency, worstProtocol, severity, statusText, anomalyDetected }
}

// ── Cross-reference analysis (pure computation) ──
export function calculateCrossRefRisk(
	results: ProtocolResult[],
	tvlMap: Record<string, bigint>,
	thresholds: PolicyThresholds,
	runtime: { log: (msg: string) => void }
): number {
	let crossRefRisk = 0

	for (const result of results) {
		const offchainTVL = tvlMap[result.name] ?? 0n

		if (!offchainTVL || Number(offchainTVL) <= 0 || Number(result.claimed) <= 0) continue

		if (result.type === 'lido') {
			runtime.log(`   ${result.name}: Solvency=${(result.solvencyRatio / 100).toFixed(2)}% | TVL=$${offchainTVL}`)
			if (result.solvencyRatio < thresholds.lidoMinBackingBps) {
				crossRefRisk += 20
				runtime.log(`   ⚠️  Lido backing below ${(thresholds.lidoMinBackingBps / 100).toFixed(0)}%`)
			} else {
				runtime.log(`   ✅ Lido backing healthy`)
			}
			continue
		}

		const share = (Number(result.claimed) / Number(offchainTVL)) * 100
		runtime.log(`   ${result.name}: Onchain=$${result.claimed} | TVL=$${offchainTVL} | Share=${share.toFixed(1)}%`)

		if (share < thresholds.crossRefShareMin || share > thresholds.crossRefShareMax) {
			crossRefRisk += 15
			runtime.log(`   ⚠️  Unusual ratio`)
		} else {
			runtime.log(`   ✅ Within range`)
		}
	}

	return crossRefRisk
}