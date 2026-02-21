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
	discordWebhookUrl: z.string().optional(),
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
	{
		// Call #15: reads stored utilizations from previous check
		inputs: [{ name: 'names', type: 'string[]' }],
		name: 'getPreviousUtilizations',
		outputs: [{ name: 'utils', type: 'uint256[]' }],
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
	utilizationBps: number
	details: string
}

interface VelocityResult {
	name: string
	currentUtilBps: number
	prevUtilBps: number
	velocityBps: number
	velocityNegative: boolean
	isAlert: boolean
}

// 5% per cycle in basis points
const VELOCITY_ALERT_THRESHOLD = 500

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
// EVM CLIENT CACHE
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
	const utilizationBps = Number(claimedUSD) > 0
		? Math.floor((Number(borrows / d) * 10000) / Number(claimedUSD))
		: 0

	return {
		name: protocol.name, type: 'aave', chain: protocol.chainName,
		claimed: claimedUSD, actual: actualUSD, solvencyRatio: ratio,
		utilizationBps,
		details: `Deposits=$${claimedUSD} | Liq=$${liquidity / d} | Borrows=$${borrows / d} | Util=${(utilizationBps / 100).toFixed(1)}%`,
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
	const utilizationBps = Number(claimedUSD) > 0
		? Math.floor((Number(totalBorrow / d) * 10000) / Number(claimedUSD))
		: 0

	return {
		name: protocol.name, type: 'compound', chain: protocol.chainName,
		claimed: claimedUSD, actual: actualUSD, solvencyRatio: ratio,
		utilizationBps,
		details: `Supply=$${claimedUSD} | Liq=$${balance / d} | Borrows=$${totalBorrow / d} | Util=${(utilizationBps / 100).toFixed(1)}%`,
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

	// Lido has no borrow utilization — use unbacking delta as proxy
	const utilizationBps = ratio >= 10000 ? 0 : Math.floor(10000 - ratio)

	return {
		name: protocol.name, type: 'lido', chain: protocol.chainName,
		claimed: claimedETH, actual: actualETH, solvencyRatio: ratio,
		utilizationBps,
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
		utilizationBps: 0,
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
// VELOCITY CALCULATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function calculateVelocities(
	results: ProtocolResult[],
	previousUtils: bigint[],
	isFirstRun: boolean
): VelocityResult[] {
	return results.map((result, i) => {
		const currentBps = result.utilizationBps
		const prevBps = Number(previousUtils[i])

		// On first run prevBps is 0 — no real delta, suppress everything
		const delta = currentBps - prevBps
		const velocityBps = isFirstRun ? 0 : Math.abs(delta)
		const velocityNegative = delta < 0
		const isAlert = !isFirstRun && velocityBps >= VELOCITY_ALERT_THRESHOLD

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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HTTP + CONSENSUS (DeFiLlama TVL)
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
// DISCORD ALERT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function toBase64(str: string): string {
	let result = ''
	let i = 0
	while (i < str.length) {
		const a = str.charCodeAt(i++)
		const b = i < str.length ? str.charCodeAt(i++) : 0
		const c = i < str.length ? str.charCodeAt(i++) : 0
		const triplet = (a << 16) | (b << 8) | c
		result += B64[(triplet >> 18) & 0x3f]
		result += B64[(triplet >> 12) & 0x3f]
		result += i - 2 < str.length ? B64[(triplet >> 6) & 0x3f] : '='
		result += i - 1 < str.length ? B64[triplet & 0x3f] : '='
	}
	return result
}

function createDiscordAlerter(webhookUrl: string, data: any) {
	return (nodeRuntime: NodeRuntime<Config>): bigint => {
		if (!webhookUrl) return 0n

		const httpClient = new HTTPClient()
		const color = data.riskScore > 0 ? 15158332 : 3066993

		let velocityFieldValue: string
		if (data.isFirstRun) {
			velocityFieldValue = 'ℹ️ Baseline seeded — velocity active from next check'
		} else if (data.velocityAlerts.length > 0) {
			velocityFieldValue = data.velocityAlerts.map((v: any) =>
				`⚡ ${v.name}: +${(v.velocityBps / 100).toFixed(1)}% → ${(v.currentUtilBps / 100).toFixed(1)}% util`
			).join('\n')
		} else {
			velocityFieldValue = '✅ No velocity spikes'
		}

		const payload = JSON.stringify({
			username: 'SENTINAL Guardian',
			embeds: [{
				title: `Health Check #${data.checkNumber} — ${data.severity}`,
				color,
				fields: [
					{ name: 'Status', value: data.severity, inline: true },
					{ name: 'Risk Score', value: `${data.riskScore}/100`, inline: true },
					{ name: 'Coverage', value: `${data.protocols} Protocols on ${data.chains} Chains`, inline: false },
					{ name: 'Aggregate Reserves', value: `$${data.totalActualUSD}`, inline: true },
					{ name: 'Worst Solvency', value: `${data.worstSolvency}% (${data.worstProtocol})`, inline: true },
					{ name: '⚡ Velocity', value: velocityFieldValue, inline: false },
					{ name: 'Transaction', value: `[View on Etherscan](https://sepolia.etherscan.io/tx/${data.txHash})`, inline: false },
				],
				footer: { text: 'Powered by Chainlink CRE | SENTINAL' },
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAIN WORKFLOW
//
// EVM Call Budget (15 max):
//   Calls  1-4:  Aave Ethereum   (getReserveData + totalSupply + balanceOf + totalSupply)
//   Calls  5-8:  Aave Arbitrum
//   Calls  9-12: Aave Base
//   Calls 13-14: Lido            (getTotalPooledEther + totalSupply)
//   Call  15:    oracle.getPreviousUtilizations()  ← velocity detection
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function healthCheckWorkflow(
	runtime: Runtime<Config>,
	payload: CronPayload
): Record<string, unknown> {
	const config = runtime.config

	const chainSet: string[] = []
	for (const p of config.protocols) {
		if (chainSet.indexOf(p.chainName) === -1) chainSet.push(p.chainName)
	}

	runtime.log('🚀 SENTINAL Multi-Chain Multi-Protocol HealthCheck')
	runtime.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
	runtime.log('📋 Capabilities: Cron | EVM Read | HTTP | Consensus | EVM Write | DON Time')
	runtime.log(`📊 Monitoring ${config.protocols.length} protocols across ${chainSet.length} chains`)
	runtime.log(`⚡ Velocity Detection: ENABLED (threshold: ${VELOCITY_ALERT_THRESHOLD / 100}% per cycle)`)
	runtime.log(`🔗 Chains: ${chainSet.join(', ')}`)
	runtime.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

	// ═══════════════════════════════════════════════
	// STEP 1: MULTI-CHAIN ONCHAIN READS (Calls 1-14)
	// ═══════════════════════════════════════════════

	runtime.log('')
	runtime.log('📡 STEP 1: Onchain Data [EVM Read — Multi-Chain] (Calls 1-14)')

	const results: ProtocolResult[] = []

	for (const protocol of config.protocols) {
		runtime.log(`   ┌─ ${protocol.name} [${protocol.chainName}]`)
		const client = getClient(protocol.chainName, protocol.isTestnet)
		const result = readProtocol(runtime, client, protocol)
		results.push(result)
		runtime.log(`   ├─ ${result.details}`)
		runtime.log(`   └─ Solvency: ${(result.solvencyRatio / 100).toFixed(2)}% | Util: ${(result.utilizationBps / 100).toFixed(1)}%`)
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
	// STEP 3: READ ORACLE STATE + PREV UTILS (Call 15)
	// ═══════════════════════════════════════════════

	runtime.log('')
	runtime.log('📡 STEP 3: Read Oracle State + Previous Utilizations [Call 15 — Sepolia]')

	const sepoliaClient = getClient(config.chainSelector, true)

	// ── Read totalChecks ────────────────────────────
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

	runtime.log(`   ✅ Current checks: ${currentChecks} → Next: #${checkNumber}`)

	// ── Call 15: Read previous utilizations ─────────
	runtime.log('   📊 Reading previous utilizations (Call 15)...')

	const protocolNames = config.protocols.map(p => p.name)
	let previousUtils: bigint[] = config.protocols.map(() => 0n)
	let isFirstRun = true

	try {
		const prevUtilCall = encodeFunctionData({
			abi: RESERVE_ORACLE_ABI,
			functionName: 'getPreviousUtilizations',
			args: [protocolNames],
		})

		const prevUtilResult = evmCall(
			sepoliaClient,
			runtime,
			config.oracleAddress,
			bytesToHex(new Uint8Array(Buffer.from(prevUtilCall.slice(2), 'hex')))
		)

		const decoded = decodeFunctionResult({
			abi: RESERVE_ORACLE_ABI,
			functionName: 'getPreviousUtilizations',
			data: bytesToHex(prevUtilResult),
		}) as bigint[]

		if (decoded.length === protocolNames.length) {
			previousUtils = decoded
			// First run = all zeros means no baseline has been stored yet
			isFirstRun = decoded.every(v => v === 0n)

			if (isFirstRun) {
				runtime.log('   ℹ️  First run detected — seeding baseline, velocity scoring suppressed')
			} else {
				runtime.log(`   ✅ Previous utils loaded (${decoded.length} protocols)`)
				for (let i = 0; i < decoded.length; i++) {
					runtime.log(`      ${protocolNames[i]}: ${(Number(decoded[i]) / 100).toFixed(1)}%`)
				}
			}
		}
	} catch {
		runtime.log('   ⚠️  Could not read previous utilizations — treating as first run')
		isFirstRun = true
	}

	// ═══════════════════════════════════════════════
	// STEP 4: VELOCITY DETECTION
	// ═══════════════════════════════════════════════

	runtime.log('')
	runtime.log(`⚡ STEP 4: Velocity Detection${isFirstRun ? ' [BASELINE RUN — no scoring]' : ''}`)

	const velocities = calculateVelocities(results, previousUtils, isFirstRun)
	const velocityAlerts = velocities.filter(v => v.isAlert)

	for (const v of velocities) {
		if (isFirstRun) {
			runtime.log(`   📌 ${v.name}: Util=${(v.currentUtilBps / 100).toFixed(1)}% (baseline stored)`)
		} else {
			const direction = v.velocityNegative ? '▼' : '▲'
			const tag = v.isAlert ? '⚡ ALERT' : '✅'
			runtime.log(`   ${tag} ${v.name}:`)
			runtime.log(`      Util: ${(v.prevUtilBps / 100).toFixed(1)}% → ${(v.currentUtilBps / 100).toFixed(1)}% ${direction}`)
			runtime.log(`      Velocity: ${(v.velocityBps / 100).toFixed(1)}%/cycle`)
		}
	}

	if (!isFirstRun) {
		if (velocityAlerts.length > 0) {
			runtime.log(`   🚨 ${velocityAlerts.length} velocity alert(s) detected!`)
		} else {
			runtime.log('   ✅ All utilization rates stable')
		}
	}

	// ═══════════════════════════════════════════════
	// STEP 5: CROSS-REFERENCE ANALYSIS
	// ═══════════════════════════════════════════════

	runtime.log('')
	runtime.log('🔍 STEP 5: Cross-Reference Analysis')

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
	// STEP 6: RISK SCORING
	// ═══════════════════════════════════════════════

	runtime.log('')
	runtime.log('🎯 STEP 6: Risk Assessment [Solvency + Velocity + CrossRef]')

	let riskScore = 0
	let worstSolvency = 10000
	let worstProtocol = ''

	// ── Solvency scoring ────────────────────────────
	for (const result of results) {
		if (result.solvencyRatio < worstSolvency) {
			worstSolvency = result.solvencyRatio
			worstProtocol = result.name
		}
		if (result.solvencyRatio < 9500) riskScore += 15
		if (result.solvencyRatio < 9000) riskScore += 10
		if (result.solvencyRatio < 8000) riskScore += 10
	}

	// ── Velocity scoring — suppressed on first run ──
	if (!isFirstRun) {
		for (const v of velocities) {
			if (v.velocityBps >= VELOCITY_ALERT_THRESHOLD && !v.velocityNegative) {
				// Sharp utilization INCREASE — borrow run signal
				riskScore += 15
				runtime.log(`   ⚡ Velocity risk: ${v.name} +${(v.velocityBps / 100).toFixed(1)}% → +15 risk`)
				if (v.velocityBps >= VELOCITY_ALERT_THRESHOLD * 3) {
					// Extreme spike (15%+ per cycle)
					riskScore += 20
					runtime.log(`   🚨 EXTREME velocity: ${v.name} → +20 additional risk`)
				}
			} else if (v.velocityBps >= VELOCITY_ALERT_THRESHOLD && v.velocityNegative) {
				// Sharp DECREASE — could be panic withdrawals
				riskScore += 10
				runtime.log(`   ⚡ Rapid withdrawal: ${v.name} -${(v.velocityBps / 100).toFixed(1)}% → +10 risk`)
			}
		}
	} else {
		runtime.log('   ℹ️  Velocity scoring skipped (first run — no baseline)')
	}

	riskScore += crossRefRisk
	if (riskScore > 100) riskScore = 100

	// anomalyDetected stays false on first run even for velocity
	const anomalyDetected = crossRefRisk > 0
		|| worstSolvency < 9500
		|| (!isFirstRun && velocityAlerts.length > 0)

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
	runtime.log(`   Velocity Alerts: ${isFirstRun ? 'N/A (first run)' : velocityAlerts.length}`)
	runtime.log(`   Anomaly:         ${anomalyDetected ? 'YES 🔴' : 'NO ✅'}`)
	runtime.log(`   Chains:          ${chainSet.length}`)
	runtime.log(`   Protocols:       ${results.length}`)
	runtime.log(`   First Run:       ${isFirstRun}`)

	// ═══════════════════════════════════════════════
	// STEP 7: SUBMIT REPORT (EVM Write + DON Time)
	// ═══════════════════════════════════════════════

	runtime.log('')
	runtime.log('📤 STEP 7: Submit Report [EVM Write + DON Time]')

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

	runtime.log('   📤 Submitting to ReserveOracleV2 on Sepolia...')

	const writeResult = sepoliaClient
		.writeReport(runtime, {
			receiver: config.oracleAddress as `0x${string}`,
			report: reportResponse,
			gasConfig: { gasLimit: '500000' },
		})
		.result()

	const txHash = bytesToHex(writeResult.txHash || new Uint8Array(32))

	// ═══════════════════════════════════════════════
	// STEP 8: DISCORD ALERT (HTTP POST)
	// ═══════════════════════════════════════════════

	if (config.discordWebhookUrl) {
		runtime.log('')
		runtime.log('🔔 STEP 8: Discord Alert [HTTP POST]')

		const alerter = createDiscordAlerter(config.discordWebhookUrl, {
			checkNumber,
			riskScore,
			severity: statusText,
			protocols: results.length,
			chains: chainSet.length,
			totalActualUSD: totalActualUSD.toString(),
			worstSolvency: (worstSolvency / 100).toFixed(2),
			worstProtocol,
			txHash,
			isFirstRun,
			velocityAlerts: velocityAlerts.map(v => ({
				name: v.name,
				velocityBps: v.velocityBps,
				currentUtilBps: v.currentUtilBps,
			})),
		})

		const alertResult = runtime
			.runInNodeMode(alerter, consensusMedianAggregation<bigint>())()
			.result()

		runtime.log(alertResult > 0n ? '   ✅ Alert sent to Discord' : '   ❌ Alert failed')
	}

	// ═══════════════════════════════════════════════
	// SUMMARY
	// ═══════════════════════════════════════════════

	runtime.log('')
	runtime.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
	runtime.log('✅ SENTINAL Multi-Chain Health Check Complete!')
	runtime.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
	for (const r of results) {
		const emoji = r.solvencyRatio >= 9500 ? '✅' : r.solvencyRatio >= 9000 ? '⚠️' : '🚨'
		const v = velocities.find(x => x.name === r.name)
		const velStr = (!isFirstRun && v && v.isAlert)
			? ` ⚡+${(v.velocityBps / 100).toFixed(1)}%`
			: ''
		runtime.log(`   ${emoji} ${r.name}: ${(r.solvencyRatio / 100).toFixed(2)}%${velStr}`)
	}
	runtime.log(`   🔗 Chains:     ${chainSet.length} (${chainSet.join(', ')})`)
	runtime.log(`   📊 Protocols:  ${results.length}`)
	runtime.log(`   💰 Reserves:   $${totalActualUSD}`)
	runtime.log(`   ⚡ Velocity:   ${isFirstRun ? 'baseline seeded' : `${velocityAlerts.length} alert(s)`}`)
	runtime.log(`   Risk:          ${riskScore}/100 — ${statusText}`)
	runtime.log(`   Check #:       ${checkNumber}`)
	runtime.log(`   Tx:            ${txHash}`)
	runtime.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

	return {
		success: true,
		checkNumber,
		isFirstRun,
		chains: chainSet,
		protocols: results.map((r, i) => ({
			name: r.name,
			type: r.type,
			chain: r.chain,
			solvency: (r.solvencyRatio / 100).toFixed(2),
			utilizationBps: r.utilizationBps,
			velocityBps: isFirstRun ? 0 : velocities[i].velocityBps,
			velocityNegative: velocities[i].velocityNegative,
			velocityAlert: isFirstRun ? false : velocities[i].isAlert,
			details: r.details,
		})),
		offchain: Object.keys(tvlMap).map((slug) => ({
			slug,
			tvl: tvlMap[slug].toString(),
		})),
		aggregate: {
			totalClaimedUSD: totalClaimedUSD.toString(),
			totalActualUSD: totalActualUSD.toString(),
			worstSolvency: (worstSolvency / 100).toFixed(2),
			worstProtocol,
		},
		velocityAlerts: isFirstRun ? [] : velocityAlerts.map(v => ({
			name: v.name,
			velocityBps: v.velocityBps,
			currentUtilBps: v.currentUtilBps,
			prevUtilBps: v.prevUtilBps,
			velocityNegative: v.velocityNegative,
		})),
		riskScore,
		severity: statusText,
		anomalyDetected,
		txHash,
	}
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// INIT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const initWorkflow = (config: Config) => {
	const cron = new CronCapability()
	return [handler(cron.trigger({ schedule: config.schedule }), healthCheckWorkflow)]
}

export async function main() {
	const runner = await Runner.newRunner<Config>({ configSchema })
	await runner.run(initWorkflow)
}