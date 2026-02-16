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
import { AavePool, ERC20 } from '../contracts/abi'

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONFIGURATION SCHEMA
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const configSchema = z.object({
	schedule: z.string(),
	oracleAddress: z.string(),
	chainSelector: z.string(),
	aaveProtocol: z.object({
		name: z.string(),
		poolAddress: z.string(),
		usdcAddress: z.string(),
		chainName: z.string(),
		decimals: z.number(),
	}),
	offchain: z.object({
		defiLlamaTVL: z.string(),
		defiLlamaProtocol: z.string(),
	}),
})

type Config = z.infer<typeof configSchema>

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ORACLE ABI (read-only)
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
// HELPER: Decode Uint8Array response body to string
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CAPABILITY 3 & 4: HTTP + CONSENSUS
// Fetch DeFiLlama TVL with multi-node validation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function createTVLFetcher(url: string) {
	return (nodeRuntime: NodeRuntime<Config>): bigint => {
		const httpClient = new HTTPClient()

		const response = httpClient
			.sendRequest(nodeRuntime, {
				url: url,
				method: 'GET',
				headers: { Accept: 'application/json' },
			})
			.result()

		const bodyStr = decodeBody(response.body)

		// /tvl/ endpoint returns a plain number
		const tvl = parseFloat(bodyStr.trim())
		if (isNaN(tvl) || tvl <= 0) return 0n

		return BigInt(Math.floor(tvl))
	}
}

// Note: /protocol/ endpoint is too large for WASM buffer
// We use /tvl/ for total and compare onchain USDC as fraction

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAIN WORKFLOW — Uses ALL 6 CRE Capabilities:
//
// 1. CRON TRIGGER      — Schedule-based execution
// 2. EVM READ          — Onchain Aave reserve data
// 3. HTTP              — Offchain DeFiLlama API
// 4. CONSENSUS         — runInNodeMode + median
// 5. EVM WRITE         — writeReport to Sepolia
// 6. RUNTIME.NOW()     — Deterministic DON time
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function healthCheckWorkflow(
	runtime: Runtime<Config>,
	payload: CronPayload
): Record<string, unknown> {
	runtime.log('🚀 SENTINAL HealthCheck — Full CRE Pipeline')
	runtime.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
	runtime.log('📋 Capabilities: Cron | EVM Read | HTTP | Consensus | EVM Write | DON Time')
	runtime.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

	const config = runtime.config

	// ═══════════════════════════════════════════════
	// STEP 1: ONCHAIN DATA — EVM READ (Capability 2)
	// Read Aave V3 USDC reserves on Ethereum Mainnet
	// ═══════════════════════════════════════════════

	runtime.log('')
	runtime.log('📡 STEP 1: Onchain Data [EVM Read — Ethereum Mainnet]')

	const mainnetNetwork = getNetwork({
		chainFamily: 'evm',
		chainSelectorName: config.aaveProtocol.chainName,
		isTestnet: false,
	})

	const mainnetClient = new EVMClient(mainnetNetwork.chainSelector.selector)

	// 1a: Get Aave reserve data for USDC
	const reserveDataCall = encodeFunctionData({
		abi: AavePool,
		functionName: 'getReserveData',
		args: [config.aaveProtocol.usdcAddress as `0x${string}`],
	})

	const reserveDataResult = mainnetClient
		.callContract(runtime, {
			call: encodeCallMsg({
				from: zeroAddress,
				to: config.aaveProtocol.poolAddress as `0x${string}`,
				data: reserveDataCall,
			}),
			blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
		})
		.result()

	const reserveData = decodeFunctionResult({
		abi: AavePool,
		functionName: 'getReserveData',
		data: bytesToHex(reserveDataResult.data),
	}) as any

	const aTokenAddress = reserveData.aTokenAddress as `0x${string}`
	const debtTokenAddress = reserveData.variableDebtTokenAddress as `0x${string}`

	runtime.log(`   aToken (aUSDC):     ${aTokenAddress}`)
	runtime.log(`   Debt Token:         ${debtTokenAddress}`)

	// 1b: Total deposits (aToken totalSupply)
	const totalSupplyCall = encodeFunctionData({
		abi: ERC20,
		functionName: 'totalSupply',
		args: [],
	})

	const depositsResult = mainnetClient
		.callContract(runtime, {
			call: encodeCallMsg({
				from: zeroAddress,
				to: aTokenAddress,
				data: totalSupplyCall,
			}),
			blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
		})
		.result()

	const rawDeposits = decodeFunctionResult({
		abi: ERC20,
		functionName: 'totalSupply',
		data: bytesToHex(depositsResult.data),
	}) as bigint

	// 1c: Available liquidity (idle USDC in pool)
	const balanceCall = encodeFunctionData({
		abi: ERC20,
		functionName: 'balanceOf',
		args: [aTokenAddress],
	})

	const liquidityResult = mainnetClient
		.callContract(runtime, {
			call: encodeCallMsg({
				from: zeroAddress,
				to: config.aaveProtocol.usdcAddress as `0x${string}`,
				data: balanceCall,
			}),
			blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
		})
		.result()

	const rawLiquidity = decodeFunctionResult({
		abi: ERC20,
		functionName: 'balanceOf',
		data: bytesToHex(liquidityResult.data),
	}) as bigint

	// 1d: Total borrows (variableDebtToken totalSupply)
	const borrowsResult = mainnetClient
		.callContract(runtime, {
			call: encodeCallMsg({
				from: zeroAddress,
				to: debtTokenAddress,
				data: totalSupplyCall,
			}),
			blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
		})
		.result()

	const rawBorrows = decodeFunctionResult({
		abi: ERC20,
		functionName: 'totalSupply',
		data: bytesToHex(borrowsResult.data),
	}) as bigint

	// Calculate solvency
	const decimals = BigInt(10 ** config.aaveProtocol.decimals)
	const depositsUSD = rawDeposits / decimals
	const liquidityUSD = rawLiquidity / decimals
	const borrowsUSD = rawBorrows / decimals
	const actualUSD = liquidityUSD + borrowsUSD

	const solvencyRatio = Number(depositsUSD) > 0
		? (Number(actualUSD) * 10000) / Number(depositsUSD)
		: 10000

	const utilizationRate = Number(depositsUSD) > 0
		? (Number(borrowsUSD) * 10000) / Number(depositsUSD)
		: 0

	runtime.log(`   ┌─ Deposits:    $${depositsUSD.toString()}`)
	runtime.log(`   ├─ Liquidity:   $${liquidityUSD.toString()}`)
	runtime.log(`   ├─ Borrows:     $${borrowsUSD.toString()}`)
	runtime.log(`   ├─ Actual:      $${actualUSD.toString()}`)
	runtime.log(`   ├─ Solvency:    ${(solvencyRatio / 100).toFixed(2)}%`)
	runtime.log(`   └─ Utilization: ${(utilizationRate / 100).toFixed(2)}%`)

	// ═══════════════════════════════════════════════
	// STEP 2: OFFCHAIN DATA — HTTP + CONSENSUS
	// (Capabilities 3 & 4)
	// Each DON node independently fetches DeFiLlama,
	// then reaches consensus via median aggregation
	// ═══════════════════════════════════════════════

	runtime.log('')
	runtime.log('🌐 STEP 2: Offchain Data [HTTP + DON Consensus]')
	runtime.log('   Each DON node fetches DeFiLlama independently...')
	runtime.log('   Consensus: Median aggregation across all nodes')

	// 2a: Fetch total Aave V3 TVL (all chains combined)
	const totalTVLFetcher = createTVLFetcher(config.offchain.defiLlamaTVL)
	const totalTVL = runtime
		.runInNodeMode(totalTVLFetcher, consensusMedianAggregation<bigint>())()
		.result()

	runtime.log(`   ✅ Total Aave V3 TVL (all chains): $${totalTVL.toString()}`)

	// ═══════════════════════════════════════════════
	// STEP 3: CROSS-REFERENCE ANALYSIS
	// Compare onchain reserves vs offchain TVL
	// Detect data manipulation or oracle attacks
	// ═══════════════════════════════════════════════

	runtime.log('')
	runtime.log('🔍 STEP 3: Cross-Reference Analysis')
	runtime.log('   Comparing onchain reserves vs offchain TVL...')

	let crossRefRisk = 0
	const onchainUSDC = Number(depositsUSD)
	const offchainTotalTVL = Number(totalTVL)

	// Check: USDC deposits should be a reasonable fraction of total Aave V3 TVL
	// USDC on Ethereum is typically 10-30% of total multi-chain TVL
	if (offchainTotalTVL > 0 && onchainUSDC > 0) {
		const usdcShareOfTotal = (onchainUSDC / offchainTotalTVL) * 100
		runtime.log(`   Onchain USDC Deposits:  $${depositsUSD.toString()}`)
		runtime.log(`   Offchain Total TVL:     $${totalTVL.toString()}`)
		runtime.log(`   USDC % of Total TVL:    ${usdcShareOfTotal.toFixed(1)}%`)

		if (usdcShareOfTotal < 3 || usdcShareOfTotal > 50) {
			crossRefRisk += 25
			runtime.log('   ⚠️  USDC share outside expected range (3-50%)')
		} else {
			runtime.log('   ✅ USDC share within expected range')
		}
	} else {
		runtime.log('   ⚠️  Missing offchain TVL data')
		crossRefRisk += 10
	}

	// ═══════════════════════════════════════════════
	// STEP 4: RISK SCORING
	// Combines onchain solvency + offchain cross-ref
	// ═══════════════════════════════════════════════

	runtime.log('')
	runtime.log('🎯 STEP 4: Risk Assessment')

	let riskScore = 0

	// Onchain solvency risk
	if (solvencyRatio < 9500) riskScore += 30
	if (solvencyRatio < 9000) riskScore += 20
	if (solvencyRatio < 8000) riskScore += 20

	// Utilization risk (bank run indicator)
	if (utilizationRate > 9000) riskScore += 15
	if (utilizationRate > 9500) riskScore += 10

	// Cross-reference risk (offchain vs onchain mismatch)
	riskScore += crossRefRisk

	if (riskScore > 100) riskScore = 100

	const anomalyDetected = crossRefRisk > 0 || solvencyRatio < 9500 || utilizationRate > 9500

	let severity: 0 | 1 | 2
	let statusText: string

	if (riskScore < 30 && solvencyRatio >= 9500) {
		severity = 0
		statusText = 'HEALTHY'
		runtime.log('   ✅ Status: HEALTHY')
	} else if (riskScore < 60 && solvencyRatio >= 9000) {
		severity = 1
		statusText = 'WARNING'
		runtime.log('   ⚠️  Status: WARNING')
	} else {
		severity = 2
		statusText = 'CRITICAL'
		runtime.log('   🚨 Status: CRITICAL')
	}

	runtime.log(`   Risk Score:     ${riskScore}/100`)
	runtime.log(`   Anomaly:        ${anomalyDetected ? 'YES 🔴' : 'NO ✅'}`)
	runtime.log(`   Data Sources:   1 onchain (Aave) + 1 offchain (DeFiLlama)`)

	// ═══════════════════════════════════════════════
	// STEP 5: READ ORACLE STATE (EVM Read — Sepolia)
	// ═══════════════════════════════════════════════

	runtime.log('')
	runtime.log('📡 STEP 5: Read Oracle State [EVM Read — Sepolia]')

	const sepoliaNetwork = getNetwork({
		chainFamily: 'evm',
		chainSelectorName: config.chainSelector,
		isTestnet: true,
	})

	const sepoliaClient = new EVMClient(sepoliaNetwork.chainSelector.selector)

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
		} else {
			runtime.log('   ⚠️  Empty response, using check #1')
		}
	} catch {
		runtime.log('   ⚠️  Could not read totalChecks, using check #1')
	}

	runtime.log(`   ✅ Current: ${currentChecks} → Next: #${checkNumber}`)

	// ═══════════════════════════════════════════════
	// STEP 6: GENERATE & SUBMIT REPORT
	// (Capability 5: EVM Write via writeReport)
	// (Capability 6: Deterministic DON time)
	// ═══════════════════════════════════════════════

	runtime.log('')
	runtime.log('📤 STEP 6: Submit Report [EVM Write + DON Time]')

	// Capability 6: Deterministic timestamp from DON consensus
	const nowSeconds = BigInt(Math.floor(runtime.now() / 1000))

	const reportData = encodeAbiParameters(
		parseAbiParameters(
			'uint256 totalReservesUSD, uint256 totalClaimedUSD, uint256 globalRatio, uint256 riskScore, uint256 timestamp, uint256 checkNumber, uint8 severity, bool anomalyDetected'
		),
		[
			actualUSD,
			depositsUSD,
			BigInt(Math.floor(solvencyRatio)),
			BigInt(riskScore),
			nowSeconds,
			BigInt(checkNumber),
			severity,
			anomalyDetected,
		]
	)

	// Generate DON-signed report
	runtime.log('   📝 Generating DON-signed report...')

	const reportResponse = runtime
		.report({
			encodedPayload: hexToBase64(reportData),
			encoderName: 'evm',
			signingAlgo: 'ecdsa',
			hashingAlgo: 'keccak256',
		})
		.result()

	// Submit via KeystoneForwarder → onReport()
	runtime.log('   📤 Submitting to ReserveOracle on Sepolia...')

	const writeResult = sepoliaClient
		.writeReport(runtime, {
			receiver: config.oracleAddress as `0x${string}`,
			report: reportResponse,
			gasConfig: {
				gasLimit: '500000',
			},
		})
		.result()

	const txHash = bytesToHex(writeResult.txHash || new Uint8Array(32))

	// ═══════════════════════════════════════════════
	// SUMMARY
	// ═══════════════════════════════════════════════

	runtime.log('')
	runtime.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
	runtime.log('✅ SENTINAL Health Check Complete!')
	runtime.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
	runtime.log(`   Onchain:    Aave V3 USDC (Ethereum Mainnet)`)
	runtime.log(`   Offchain:   DeFiLlama TVL (DON consensus-validated)`)
	runtime.log(`   Solvency:   ${(solvencyRatio / 100).toFixed(2)}%`)
	runtime.log(`   Risk:       ${riskScore}/100 — ${statusText}`)
	runtime.log(`   Check #:    ${checkNumber}`)
	runtime.log(`   Tx:         ${txHash}`)
	runtime.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

	return {
		success: true,
		protocol: config.aaveProtocol.name,
		checkNumber: checkNumber,
		onchain: {
			deposits: depositsUSD.toString(),
			liquidity: liquidityUSD.toString(),
			borrows: borrowsUSD.toString(),
			actual: actualUSD.toString(),
			solvencyRatio: (solvencyRatio / 100).toFixed(2),
			utilizationRate: (utilizationRate / 100).toFixed(2),
		},
		offchain: {
			totalAaveTVL: totalTVL.toString(),
ethereumTVL: 'N/A',
			source: 'DeFiLlama (DON consensus-validated)',
		},
		crossReference: {
			crossRefRisk: crossRefRisk,
			dataSources: 3,
		},
		riskScore: riskScore,
		severity: statusText,
		anomalyDetected: anomalyDetected,
		txHash: txHash,
	}
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// INITIALIZATION (Capability 1: Cron Trigger)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const initWorkflow = (config: Config) => {
	const cron = new CronCapability()
	return [handler(cron.trigger({ schedule: config.schedule }), healthCheckWorkflow)]
}

export async function main() {
	const runner = await Runner.newRunner<Config>({ configSchema })
	await runner.run(initWorkflow)
}