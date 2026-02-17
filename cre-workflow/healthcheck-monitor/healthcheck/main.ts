import {
	CronPayload,
	handler,
	CronCapability,
	EVMClient,
	Runner,
	Runtime,
	getNetwork,
	LAST_FINALIZED_BLOCK_NUMBER,
	encodeCallMsg,
	bytesToHex,
	hexToBase64,
	HTTPClient,
	type NodeRuntime,
	consensusMedianAggregation,
} from '@chainlink/cre-sdk'
import { encodeFunctionData, decodeFunctionResult, zeroAddress, encodeAbiParameters, parseAbiParameters } from 'viem'
import { z } from 'zod'
import { AavePool, ERC20, CompoundComet, LidoStETH, ERC4626 } from '../contracts/abi'

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONFIGURATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const configSchema = z.object({
	schedule: z.string(),
	oracleAddress: z.string(),
	chainSelector: z.string(),
	protocols: z.array(
		z.object({
			name: z.string(),
			type: z.string(),
			poolAddress: z.string(),
			assetAddress: z.string(),
			chainName: z.string(),
			isTestnet: z.boolean(),
			decimals: z.number(),
			defiLlamaSlug: z.string(),
		})
	),
})

type Config = z.infer<typeof configSchema>
type Protocol = Config['protocols'][0]

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ORACLE ABI
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const RESERVE_ORACLE_ABI = [
	{
		inputs: [],
		name: 'totalChecks',
		outputs: [{ name: '', type: 'uint256' }],
		stateMutability: 'view',
		type: 'function',
	},
] as const

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TYPES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface ProtocolResult {
	name: string
	type: string
	chain: string
	claimed: bigint
	actual: bigint
	solvencyRatio: number
	details: string
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HELPERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function decodeBody(body: unknown): string {
	if (typeof body === 'string') return body
	const bytes = new Uint8Array(body as ArrayBuffer)
	let str = ''
	for (let i = 0; i < bytes.length; i++) {
		str += String.fromCharCode(bytes[i])
	}
	return str
}

function evmCall(
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// EVM CLIENT CACHE (one client per chain)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const clientCache: Record<string, EVMClient> = {}

function getClient(chainName: string, isTestnet: boolean): EVMClient {
	if (!clientCache[chainName]) {
		const network = getNetwork({
			chainFamily: 'evm',
			chainSelectorName: chainName,
			isTestnet: isTestnet,
		})
		clientCache[chainName] = new EVMClient(network.chainSelector.selector)
	}
	return clientCache[chainName]
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PROTOCOL READERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function readAave(
	runtime: Runtime<Config>,
	client: EVMClient,
	protocol: Protocol
): ProtocolResult {
	const reserveCall = encodeFunctionData({
		abi: AavePool, functionName: 'getReserveData',
		args: [protocol.assetAddress as `0x${string}`],
	})
	const reserveData = decodeFunctionResult({
		abi: AavePool, functionName: 'getReserveData',
		data: bytesToHex(evmCall(client, runtime, protocol.poolAddress, reserveCall)),
	}) as any

	const aToken = reserveData.aTokenAddress as string
	const debtToken = reserveData.variableDebtTokenAddress as string

	const supplyCall = encodeFunctionData({ abi: ERC20, functionName: 'totalSupply', args: [] })
	const balanceCall = encodeFunctionData({ abi: ERC20, functionName: 'balanceOf', args: [aToken as `0x${string}`] })

	const deposits = decodeFunctionResult({
		abi: ERC20, functionName: 'totalSupply',
		data: bytesToHex(evmCall(client, runtime, aToken, supplyCall)),
	}) as bigint

	const liquidity = decodeFunctionResult({
		abi: ERC20, functionName: 'balanceOf',
		data: bytesToHex(evmCall(client, runtime, protocol.assetAddress, balanceCall)),
	}) as bigint

	const borrows = decodeFunctionResult({
		abi: ERC20, functionName: 'totalSupply',
		data: bytesToHex(evmCall(client, runtime, debtToken, supplyCall)),
	}) as bigint

	const d = BigInt(10 ** protocol.decimals)
	const claimedUSD = deposits / d
	const actualUSD = (liquidity + borrows) / d
	const ratio = Number(claimedUSD) > 0 ? (Number(actualUSD) * 10000) / Number(claimedUSD) : 10000
	const util = Number(claimedUSD) > 0 ? (Number(borrows / d) * 100) / Number(claimedUSD) : 0

	return {
		name: protocol.name, type: 'aave', chain: protocol.chainName,
		claimed: claimedUSD, actual: actualUSD, solvencyRatio: ratio,
		details: `Deposits=$${claimedUSD} | Liq=$${liquidity / d} | Borrows=$${borrows / d} | Util=${util.toFixed(1)}%`,
	}
}

function readCompound(
	runtime: Runtime<Config>,
	client: EVMClient,
	protocol: Protocol
): ProtocolResult {
	const supplyCall = encodeFunctionData({ abi: CompoundComet, functionName: 'totalSupply', args: [] })
	const borrowCall = encodeFunctionData({ abi: CompoundComet, functionName: 'totalBorrow', args: [] })
	const balanceCall = encodeFunctionData({ abi: ERC20, functionName: 'balanceOf', args: [protocol.poolAddress as `0x${string}`] })

	const totalSupply = decodeFunctionResult({
		abi: CompoundComet, functionName: 'totalSupply',
		data: bytesToHex(evmCall(client, runtime, protocol.poolAddress, supplyCall)),
	}) as bigint

	const totalBorrow = decodeFunctionResult({
		abi: CompoundComet, functionName: 'totalBorrow',
		data: bytesToHex(evmCall(client, runtime, protocol.poolAddress, borrowCall)),
	}) as bigint

	const balance = decodeFunctionResult({
		abi: ERC20, functionName: 'balanceOf',
		data: bytesToHex(evmCall(client, runtime, protocol.assetAddress, balanceCall)),
	}) as bigint

	const d = BigInt(10 ** protocol.decimals)
	const claimedUSD = totalSupply / d
	const actualUSD = (balance + totalBorrow) / d
	const ratio = Number(claimedUSD) > 0 ? (Number(actualUSD) * 10000) / Number(claimedUSD) : 10000
	const util = Number(claimedUSD) > 0 ? (Number(totalBorrow / d) * 100) / Number(claimedUSD) : 0

	return {
		name: protocol.name, type: 'compound', chain: protocol.chainName,
		claimed: claimedUSD, actual: actualUSD, solvencyRatio: ratio,
		details: `Supply=$${claimedUSD} | Liq=$${balance / d} | Borrows=$${totalBorrow / d} | Util=${util.toFixed(1)}%`,
	}
}

function readLido(
	runtime: Runtime<Config>,
	client: EVMClient,
	protocol: Protocol
): ProtocolResult {
	const pooledCall = encodeFunctionData({ abi: LidoStETH, functionName: 'getTotalPooledEther', args: [] })
	const supplyCall = encodeFunctionData({ abi: LidoStETH, functionName: 'totalSupply', args: [] })

	const pooledEther = decodeFunctionResult({
		abi: LidoStETH, functionName: 'getTotalPooledEther',
		data: bytesToHex(evmCall(client, runtime, protocol.poolAddress, pooledCall)),
	}) as bigint

	const totalStETH = decodeFunctionResult({
		abi: LidoStETH, functionName: 'totalSupply',
		data: bytesToHex(evmCall(client, runtime, protocol.poolAddress, supplyCall)),
	}) as bigint

	const d = BigInt(10 ** protocol.decimals)
	const claimedETH = totalStETH / d
	const actualETH = pooledEther / d
	const ratio = Number(claimedETH) > 0 ? (Number(actualETH) * 10000) / Number(claimedETH) : 10000

	return {
		name: protocol.name, type: 'lido', chain: protocol.chainName,
		claimed: claimedETH, actual: actualETH, solvencyRatio: ratio,
		details: `stETH=${claimedETH} ETH | Pooled=${actualETH} ETH | Backing=${(ratio / 100).toFixed(2)}%`,
	}
}

function readERC4626(
	runtime: Runtime<Config>,
	client: EVMClient,
	protocol: Protocol
): ProtocolResult {
	const assetsCall = encodeFunctionData({ abi: ERC4626, functionName: 'totalAssets', args: [] })
	const supplyCall = encodeFunctionData({ abi: ERC4626, functionName: 'totalSupply', args: [] })

	const totalAssets = decodeFunctionResult({
		abi: ERC4626, functionName: 'totalAssets',
		data: bytesToHex(evmCall(client, runtime, protocol.poolAddress, assetsCall)),
	}) as bigint

	const totalShares = decodeFunctionResult({
		abi: ERC4626, functionName: 'totalSupply',
		data: bytesToHex(evmCall(client, runtime, protocol.poolAddress, supplyCall)),
	}) as bigint

	const d = BigInt(10 ** protocol.decimals)
	const claimedUSD = totalShares / d
	const actualUSD = totalAssets / d
	const ratio = Number(claimedUSD) > 0 ? (Number(actualUSD) * 10000) / Number(claimedUSD) : 10000

	return {
		name: protocol.name, type: 'erc4626', chain: protocol.chainName,
		claimed: claimedUSD, actual: actualUSD, solvencyRatio: ratio,
		details: `Shares=$${claimedUSD} | Assets=$${actualUSD} | Backing=${(ratio / 100).toFixed(2)}%`,
	}
}

function readProtocol(
	runtime: Runtime<Config>,
	client: EVMClient,
	protocol: Protocol
): ProtocolResult {
	switch (protocol.type) {
		case 'aave': return readAave(runtime, client, protocol)
		case 'compound': return readCompound(runtime, client, protocol)
		case 'lido': return readLido(runtime, client, protocol)
		case 'erc4626': return readERC4626(runtime, client, protocol)
		default: throw new Error(`Unknown protocol type: ${protocol.type}`)
	}
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HTTP + CONSENSUS (Capabilities 3 & 4)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function createTVLFetcher(slug: string) {
	return (nodeRuntime: NodeRuntime<Config>): bigint => {
		const httpClient = new HTTPClient()
		const response = httpClient
			.sendRequest(nodeRuntime, {
				url: `https://api.llama.fi/tvl/${slug}`,
				method: 'GET',
				headers: { Accept: 'application/json' },
			})
			.result()

		const bodyStr = decodeBody(response.body)
		const tvl = parseFloat(bodyStr.trim())
		if (isNaN(tvl) || tvl <= 0) return 0n
		return BigInt(Math.floor(tvl))
	}
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAIN WORKFLOW
//
// Multi-Chain + Multi-Protocol × 6 CRE Capabilities
//
// 1. CRON TRIGGER       — Schedule-based
// 2. EVM READ           — 3 chains × 6 protocols
// 3. HTTP               — DeFiLlama per protocol
// 4. CONSENSUS          — runInNodeMode + median
// 5. EVM WRITE          — DON-signed → Sepolia
// 6. RUNTIME.NOW()      — Deterministic DON time
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function healthCheckWorkflow(
	runtime: Runtime<Config>,
	payload: CronPayload
): Record<string, unknown> {
	const config = runtime.config

	// Count unique chains
	const chainSet: string[] = []
	for (const p of config.protocols) {
		if (chainSet.indexOf(p.chainName) === -1) chainSet.push(p.chainName)
	}

	runtime.log('🚀 SENTINAL Multi-Chain Multi-Protocol HealthCheck')
	runtime.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
	runtime.log('📋 Capabilities: Cron | EVM Read | HTTP | Consensus | EVM Write | DON Time')
	runtime.log(`📊 Monitoring ${config.protocols.length} protocols across ${chainSet.length} chains`)
	runtime.log(`🔗 Chains: ${chainSet.join(', ')}`)
	runtime.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

	// ═══════════════════════════════════════════════
	// STEP 1: MULTI-CHAIN ONCHAIN READS
	// ═══════════════════════════════════════════════

	runtime.log('')
	runtime.log('📡 STEP 1: Onchain Data [EVM Read — Multi-Chain]')

	const results: ProtocolResult[] = []

	for (const protocol of config.protocols) {
		runtime.log(`   ┌─ ${protocol.name} [${protocol.chainName}]`)
		const client = getClient(protocol.chainName, protocol.isTestnet)
		const result = readProtocol(runtime, client, protocol)
		results.push(result)
		runtime.log(`   ├─ ${result.details}`)
		runtime.log(`   └─ Solvency: ${(result.solvencyRatio / 100).toFixed(2)}%`)
		runtime.log('')
	}

	// ═══════════════════════════════════════════════
	// STEP 2: OFFCHAIN DATA — HTTP + CONSENSUS
	// ═══════════════════════════════════════════════

	runtime.log('🌐 STEP 2: Offchain Data [HTTP + DON Consensus]')

	const slugs: string[] = []
	for (const p of config.protocols) {
		if (slugs.indexOf(p.defiLlamaSlug) === -1) slugs.push(p.defiLlamaSlug)
	}
	slugs.sort()

	const tvlMap: Record<string, bigint> = {}

	for (const slug of slugs) {
		const fetcher = createTVLFetcher(slug)
		const tvl = runtime
			.runInNodeMode(fetcher, consensusMedianAggregation<bigint>())()
			.result()
		tvlMap[slug] = tvl
		runtime.log(`   ✅ ${slug}: $${tvl.toString()}`)
	}

	// ═══════════════════════════════════════════════
	// STEP 3: CROSS-REFERENCE ANALYSIS
	// ═══════════════════════════════════════════════

	runtime.log('')
	runtime.log('🔍 STEP 3: Cross-Reference Analysis')

	let crossRefRisk = 0

	for (const result of results) {
		const protocol = config.protocols.filter((p) => p.name === result.name)[0]
		const offchainTVL = tvlMap[protocol.defiLlamaSlug]

		if (offchainTVL && Number(offchainTVL) > 0 && Number(result.claimed) > 0) {
			if (result.type === 'lido') {
				runtime.log(`   ${result.name}: Solvency=${(result.solvencyRatio / 100).toFixed(2)}% | TVL=$${offchainTVL}`)
				if (result.solvencyRatio < 9900) {
					crossRefRisk += 20
					runtime.log(`   ⚠️  Lido backing below 99%`)
				} else {
					runtime.log(`   ✅ Lido backing healthy`)
				}
				continue
			}

			const share = (Number(result.claimed) / Number(offchainTVL)) * 100
			runtime.log(`   ${result.name}: Onchain=$${result.claimed} | TVL=$${offchainTVL} | Share=${share.toFixed(1)}%`)

			if (share < 0.5 || share > 200) {
				crossRefRisk += 15
				runtime.log(`   ⚠️  Unusual ratio`)
			} else {
				runtime.log(`   ✅ Within range`)
			}
		}
	}

	// ═══════════════════════════════════════════════
	// STEP 4: RISK SCORING
	// ═══════════════════════════════════════════════

	runtime.log('')
	runtime.log('🎯 STEP 4: Risk Assessment')

	let riskScore = 0
	let worstSolvency = 10000
	let worstProtocol = ''

	for (const result of results) {
		if (result.solvencyRatio < worstSolvency) {
			worstSolvency = result.solvencyRatio
			worstProtocol = result.name
		}
		if (result.solvencyRatio < 9500) riskScore += 15
		if (result.solvencyRatio < 9000) riskScore += 10
		if (result.solvencyRatio < 8000) riskScore += 10
	}

	riskScore += crossRefRisk
	if (riskScore > 100) riskScore = 100

	const anomalyDetected = crossRefRisk > 0 || worstSolvency < 9500

	let severity: 0 | 1 | 2
	let statusText: string

	if (riskScore < 30 && worstSolvency >= 9500) {
		severity = 0
		statusText = 'HEALTHY'
		runtime.log('   ✅ Status: HEALTHY')
	} else if (riskScore < 60 && worstSolvency >= 9000) {
		severity = 1
		statusText = 'WARNING'
		runtime.log('   ⚠️  Status: WARNING')
	} else {
		severity = 2
		statusText = 'CRITICAL'
		runtime.log('   🚨 Status: CRITICAL')
	}

	runtime.log(`   Risk Score:      ${riskScore}/100`)
	runtime.log(`   Worst Protocol:  ${worstProtocol} (${(worstSolvency / 100).toFixed(2)}%)`)
	runtime.log(`   Anomaly:         ${anomalyDetected ? 'YES 🔴' : 'NO ✅'}`)
	runtime.log(`   Chains:          ${chainSet.length}`)
	runtime.log(`   Protocols:       ${results.length}`)
	runtime.log(`   Data Sources:    ${results.length} onchain + ${slugs.length} offchain`)

	// ═══════════════════════════════════════════════
	// STEP 5: READ ORACLE STATE (Sepolia)
	// ═══════════════════════════════════════════════

	runtime.log('')
	runtime.log('📡 STEP 5: Read Oracle State [Sepolia]')

	const sepoliaClient = getClient(config.chainSelector, true)

	const checksCall = encodeFunctionData({
		abi: RESERVE_ORACLE_ABI,
		functionName: 'totalChecks',
		args: [],
	})

	let currentChecks = 0
	let checkNumber = 1

	try {
		const checksResult = sepoliaClient
			.callContract(runtime, {
				call: encodeCallMsg({
					from: zeroAddress,
					to: config.oracleAddress as `0x${string}`,
					data: checksCall,
				}),
				blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
			})
			.result()

		if (checksResult.data && checksResult.data.length > 0) {
			const decoded = decodeFunctionResult({
				abi: RESERVE_ORACLE_ABI,
				functionName: 'totalChecks',
				data: bytesToHex(checksResult.data),
			})
			currentChecks = Number(decoded)
			checkNumber = currentChecks + 1
		}
	} catch {
		runtime.log('   ⚠️  Could not read totalChecks')
	}

	runtime.log(`   ✅ Current: ${currentChecks} → Next: #${checkNumber}`)

	// ═══════════════════════════════════════════════
	// STEP 6: SUBMIT REPORT (EVM Write + DON Time)
	// ═══════════════════════════════════════════════

	runtime.log('')
	runtime.log('📤 STEP 6: Submit Report [EVM Write + DON Time]')

	const nowSeconds = BigInt(Math.floor(runtime.now() / 1000))

	let totalClaimedUSD = 0n
	let totalActualUSD = 0n
	for (const r of results) {
		if (r.type === 'aave' || r.type === 'compound' || r.type === 'erc4626') {
			totalClaimedUSD += r.claimed
			totalActualUSD += r.actual
		}
	}

	const reportData = encodeAbiParameters(
		parseAbiParameters(
			'uint256 totalReservesUSD, uint256 totalClaimedUSD, uint256 globalRatio, uint256 riskScore, uint256 timestamp, uint256 checkNumber, uint8 severity, bool anomalyDetected'
		),
		[
			totalActualUSD,
			totalClaimedUSD,
			BigInt(Math.floor(worstSolvency)),
			BigInt(riskScore),
			nowSeconds,
			BigInt(checkNumber),
			severity,
			anomalyDetected,
		]
	)

	runtime.log('   📝 Generating DON-signed report...')

	const reportResponse = runtime
		.report({
			encodedPayload: hexToBase64(reportData),
			encoderName: 'evm',
			signingAlgo: 'ecdsa',
			hashingAlgo: 'keccak256',
		})
		.result()

	runtime.log('   📤 Submitting to ReserveOracle on Sepolia...')

	const writeResult = sepoliaClient
		.writeReport(runtime, {
			receiver: config.oracleAddress as `0x${string}`,
			report: reportResponse,
			gasConfig: { gasLimit: '500000' },
		})
		.result()

	const txHash = bytesToHex(writeResult.txHash || new Uint8Array(32))

	// ═══════════════════════════════════════════════
	// SUMMARY
	// ═══════════════════════════════════════════════

	runtime.log('')
	runtime.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
	runtime.log('✅ SENTINAL Multi-Chain Health Check Complete!')
	runtime.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
	for (const r of results) {
		const emoji = r.solvencyRatio >= 9500 ? '✅' : r.solvencyRatio >= 9000 ? '⚠️' : '🚨'
		runtime.log(`   ${emoji} ${r.name}: ${(r.solvencyRatio / 100).toFixed(2)}%`)
	}
	runtime.log(`   🔗 Chains:     ${chainSet.length} (${chainSet.join(', ')})`)
	runtime.log(`   📊 Protocols:  ${results.length}`)
	runtime.log(`   Risk:          ${riskScore}/100 — ${statusText}`)
	runtime.log(`   Check #:       ${checkNumber}`)
	runtime.log(`   Tx:            ${txHash}`)
	runtime.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

	return {
		success: true,
		checkNumber: checkNumber,
		chains: chainSet,
		protocols: results.map((r) => ({
			name: r.name,
			type: r.type,
			chain: r.chain,
			solvency: (r.solvencyRatio / 100).toFixed(2),
			details: r.details,
		})),
		offchain: Object.keys(tvlMap).map((slug) => ({
			slug: slug,
			tvl: tvlMap[slug].toString(),
		})),
		aggregate: {
			totalClaimedUSD: totalClaimedUSD.toString(),
			totalActualUSD: totalActualUSD.toString(),
			worstSolvency: (worstSolvency / 100).toFixed(2),
			worstProtocol: worstProtocol,
		},
		riskScore: riskScore,
		severity: statusText,
		anomalyDetected: anomalyDetected,
		txHash: txHash,
	}
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// INIT (Capability 1: Cron Trigger)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const initWorkflow = (config: Config) => {
	const cron = new CronCapability()
	return [handler(cron.trigger({ schedule: config.schedule }), healthCheckWorkflow)]
}

export async function main() {
	const runner = await Runner.newRunner<Config>({ configSchema })
	await runner.run(initWorkflow)
}