// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SENTINAL — Multicall3 Batching
//
// Multicall3 is deployed at the same address on every
// major EVM chain. Batches N reads into 1 EVM call,
// freeing up budget for new capabilities.
//
// Budget savings vs individual calls:
//   Aave (3 chains × 2 calls each) = 6  (was 12)
//   Lido multicall                 = 1  (was 2)
//   Total saved:                   = 7 calls freed
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { EVMClient, Runtime, LAST_FINALIZED_BLOCK_NUMBER, encodeCallMsg, bytesToHex } from '@chainlink/cre-sdk'
import { encodeFunctionData, decodeFunctionResult, zeroAddress } from 'viem'
import type { Config } from '../../config/schema'

// Multicall3 — same address on all EVM chains
export const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11'

const MULTICALL3_ABI = [
	{
		inputs: [
			{
				components: [
					{ name: 'target', type: 'address' },
					{ name: 'allowFailure', type: 'bool' },
					{ name: 'callData', type: 'bytes' },
				],
				name: 'calls',
				type: 'tuple[]',
			},
		],
		name: 'aggregate3',
		outputs: [
			{
				components: [
					{ name: 'success', type: 'bool' },
					{ name: 'returnData', type: 'bytes' },
				],
				name: 'returnData',
				type: 'tuple[]',
			},
		],
		stateMutability: 'payable',
		type: 'function',
	},
] as const

export interface MulticallRequest {
	target: string
	callData: string
	allowFailure?: boolean
}

export interface MulticallResult {
	success: boolean
	returnData: `0x${string}`
}

// ── Execute batched calls in ONE EVM call ─────────
export function multicall(
	client: EVMClient,
	runtime: Runtime<Config>,
	requests: MulticallRequest[]
): MulticallResult[] {
	const callData = encodeFunctionData({
		abi: MULTICALL3_ABI,
		functionName: 'aggregate3',
		args: [
			requests.map(r => ({
				target: r.target as `0x${string}`,
				allowFailure: r.allowFailure ?? true,
				callData: r.callData as `0x${string}`,
			})),
		],
	})

	const raw = client
		.callContract(runtime, {
			call: encodeCallMsg({
				from: zeroAddress,
				to: MULTICALL3_ADDRESS as `0x${string}`,
				data: callData,
			}),
			blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
		})
		.result().data

	const decoded = decodeFunctionResult({
		abi: MULTICALL3_ABI,
		functionName: 'aggregate3',
		data: bytesToHex(raw),
	}) as Array<{ success: boolean; returnData: `0x${string}` }>

	return decoded.map(r => ({
		success: r.success,
		returnData: r.returnData,
	}))
}