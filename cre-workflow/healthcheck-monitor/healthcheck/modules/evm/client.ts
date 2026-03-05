// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SENTINAL — EVM Client Module
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import {
	EVMClient,
	Runtime,
	getNetwork,
	LAST_FINALIZED_BLOCK_NUMBER,
	encodeCallMsg,
	bytesToHex,
} from '@chainlink/cre-sdk'
import { zeroAddress } from 'viem'
import type { Config } from '../../config/schema'

// ── Client Cache ──────────────────────────────────
const clientCache: Record<string, EVMClient> = {}

export function getClient(chainName: string, isTestnet: boolean): EVMClient {
	const key = `${chainName}:${isTestnet}`
	if (!clientCache[key]) {
		const network = getNetwork({
			chainFamily: 'evm',
			chainSelectorName: chainName,
			isTestnet,
		})
		clientCache[key] = new EVMClient(network.chainSelector.selector)
	}
	return clientCache[key]
}

// ── Single EVM Call ───────────────────────────────
export function evmCall(
	client: EVMClient,
	runtime: Runtime<Config>,
	to: string,
	data: string
): Uint8Array {
	return client
		.callContract(runtime, {
			call: encodeCallMsg({
				from: zeroAddress,
				to: to as `0x${string}`,
				data: data as `0x${string}`,
			}),
			blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
		})
		.result().data
}