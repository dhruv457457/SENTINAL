// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SENTINAL — Protocol Reader Dispatcher
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { EVMClient, Runtime } from '@chainlink/cre-sdk'
import { readAave } from './aave'
import { readLido, readCompound, readERC4626 } from './others'
import type { Config, Protocol } from '../../config/schema'
import type { ProtocolResult } from '../../types'

export function readProtocol(
	runtime: Runtime<Config>,
	client: EVMClient,
	protocol: Protocol
): ProtocolResult {
	switch (protocol.type) {
		case 'aave':     return readAave(runtime, client, protocol)
		case 'compound': return readCompound(runtime, client, protocol)
		case 'lido':     return readLido(runtime, client, protocol)
		case 'erc4626':  return readERC4626(runtime, client, protocol)
		default: throw new Error(`Unknown protocol type: ${protocol.type}`)
	}
}