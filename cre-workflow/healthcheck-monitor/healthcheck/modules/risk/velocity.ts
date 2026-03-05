// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SENTINAL — Velocity Detection
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { ProtocolResult, VelocityResult, PolicyThresholds } from '../../types'

export function calculateVelocities(
	results: ProtocolResult[],
	previousUtils: bigint[],
	isFirstRun: boolean,
	thresholds: PolicyThresholds
): VelocityResult[] {
	return results.map((result, i) => {
		const currentBps = result.utilizationBps
		const prevBps = Number(previousUtils[i])
		const delta = currentBps - prevBps
		const velocityBps = isFirstRun ? 0 : Math.abs(delta)
		const velocityNegative = delta < 0
		const isAlert = !isFirstRun && velocityBps >= thresholds.velocityAlertBps

		return {
			name: result.name,
			currentUtilBps: currentBps,
			prevUtilBps: prevBps,
			velocityBps,
			velocityNegative,
			isAlert,
		}
	})
}