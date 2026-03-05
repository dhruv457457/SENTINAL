// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SENTINAL — Discord Alert Module
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { HTTPClient, type NodeRuntime } from '@chainlink/cre-sdk'
import { toBase64 } from '../utils/encoding'
import type { Config } from '../../config/schema'
import type { VelocityResult, ContagionResult } from '../../types'

interface AlertData {
	checkNumber: number
	riskScore: number
	severity: string
	protocols: number
	chains: number
	totalActualUSD: string
	worstSolvency: string
	worstProtocol: string
	txHash: string
	isFirstRun: boolean
	velocityAlerts: VelocityResult[]
	contagion: ContagionResult
	policyHash: string
	policyVersion: string
}

export function createDiscordAlerter(webhookUrl: string, data: AlertData) {
	return (nodeRuntime: NodeRuntime<Config>): bigint => {
		if (!webhookUrl) return 0n

		const httpClient = new HTTPClient()
		const color = data.riskScore > 59 ? 15158332 : data.riskScore > 29 ? 16776960 : 3066993

		// ── Velocity field ────────────────────────
		let velocityFieldValue: string
		if (data.isFirstRun) {
			velocityFieldValue = 'ℹ️ Baseline seeded — velocity active from next check'
		} else if (data.velocityAlerts.length > 0) {
			velocityFieldValue = data.velocityAlerts.map(v =>
				`⚡ ${v.name}: +${(v.velocityBps / 100).toFixed(1)}% → ${(v.currentUtilBps / 100).toFixed(1)}% util`
			).join('\n')
		} else {
			velocityFieldValue = '✅ No velocity spikes'
		}

		// ── Contagion field ───────────────────────
		const contagionFieldValue = data.contagion.detected
			? `🔴 ${data.contagion.description}\n+${data.contagion.tierEscalation} risk escalation`
			: '✅ No cross-chain contagion'

		// ── Policy field ──────────────────────────
		const policyFieldValue = `v${data.policyVersion}\n\`${data.policyHash.slice(0, 18)}...\``

		const payload = JSON.stringify({
			username: 'SENTINAL Guardian',
			embeds: [{
				title: `Health Check #${data.checkNumber} — ${data.severity}`,
				color,
				fields: [
					{ name: 'Status', value: data.severity, inline: true },
					{ name: 'Risk Score', value: `${data.riskScore}/100`, inline: true },
					{ name: 'Policy', value: policyFieldValue, inline: true },
					{ name: 'Coverage', value: `${data.protocols} Protocols | ${data.chains} Chains`, inline: false },
					{ name: 'Aggregate Reserves', value: `$${data.totalActualUSD}`, inline: true },
					{ name: 'Worst Solvency', value: `${data.worstSolvency}% (${data.worstProtocol})`, inline: true },
					{ name: '⚡ Velocity', value: velocityFieldValue, inline: false },
					{ name: '🔗 Contagion', value: contagionFieldValue, inline: false },
					{ name: 'Transaction', value: `[View on Etherscan](https://sepolia.etherscan.io/tx/${data.txHash})`, inline: false },
				],
				footer: { text: 'Powered by Chainlink CRE | SENTINAL — Confidential Policy Enforcement' },
			}],
		})

		try {
			httpClient.sendRequest(nodeRuntime, {
				url: webhookUrl,
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: toBase64(payload),
			}).result()
			return 1n
		} catch {
			return 0n
		}
	}
}