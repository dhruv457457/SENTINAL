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
	}),
})

type Config = z.infer<typeof configSchema>

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RESERVE ORACLE ABI (read-only)
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
// MAIN WORKFLOW
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function healthCheckWorkflow(
	runtime: Runtime<Config>,
	payload: CronPayload
): Record<string, unknown> {
	runtime.log('🚀 Starting HealthCheck CRE Workflow...')
	runtime.log('🏥 HealthCheck Monitor - REAL Aave Data')
	runtime.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

	const config = runtime.config
	runtime.log(`📊 Protocol: ${config.aaveProtocol.name}`)

	// ━━━━ STEP 1: Read from Aave Mainnet ━━━━
	runtime.log('📡 Reading from Aave on Ethereum Mainnet...')

	const aaveNetwork = getNetwork({
		chainFamily: 'evm',
		chainSelectorName: config.aaveProtocol.chainName,
		isTestnet: false,
	})

	const aaveClient = new EVMClient(aaveNetwork.chainSelector.selector)

	// ── 1a: Get Aave reserve data for USDC ──
	const reserveDataCall = encodeFunctionData({
		abi: AavePool,
		functionName: 'getReserveData',
		args: [config.aaveProtocol.usdcAddress as `0x${string}`],
	})

	const reserveDataResult = aaveClient
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
	const variableDebtTokenAddress = reserveData.variableDebtTokenAddress as `0x${string}`

	runtime.log(`✅ aToken (aUSDC): ${aTokenAddress}`)
	runtime.log(`✅ Variable Debt Token: ${variableDebtTokenAddress}`)

	// ── 1b: Read total deposits (aToken totalSupply) ──
	// This is what users CLAIM to have deposited
	const totalSupplyCall = encodeFunctionData({
		abi: ERC20,
		functionName: 'totalSupply',
		args: [],
	})

	const totalSupplyResult = aaveClient
		.callContract(runtime, {
			call: encodeCallMsg({
				from: zeroAddress,
				to: aTokenAddress,
				data: totalSupplyCall,
			}),
			blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
		})
		.result()

	const totalDeposits = decodeFunctionResult({
		abi: ERC20,
		functionName: 'totalSupply',
		data: bytesToHex(totalSupplyResult.data),
	}) as bigint

	// ── 1c: Read actual USDC balance in aToken contract ──
	// This is idle liquidity sitting in the pool
	const balanceCall = encodeFunctionData({
		abi: ERC20,
		functionName: 'balanceOf',
		args: [aTokenAddress],
	})

	const balanceResult = aaveClient
		.callContract(runtime, {
			call: encodeCallMsg({
				from: zeroAddress,
				to: config.aaveProtocol.usdcAddress as `0x${string}`,
				data: balanceCall,
			}),
			blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
		})
		.result()

	const availableLiquidity = decodeFunctionResult({
		abi: ERC20,
		functionName: 'balanceOf',
		data: bytesToHex(balanceResult.data),
	}) as bigint

	// ── 1d: Read total borrows (variableDebtToken totalSupply) ──
	// This is what borrowers owe back — it's still "accounted for"
	const debtSupplyResult = aaveClient
		.callContract(runtime, {
			call: encodeCallMsg({
				from: zeroAddress,
				to: variableDebtTokenAddress,
				data: totalSupplyCall, // reuse same encoded call
			}),
			blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
		})
		.result()

	const totalBorrows = decodeFunctionResult({
		abi: ERC20,
		functionName: 'totalSupply',
		data: bytesToHex(debtSupplyResult.data),
	}) as bigint

	// ━━━━ STEP 2: Calculate REAL Solvency ━━━━
	//
	// Aave lending math:
	//   totalDeposits = what users deposited (aToken totalSupply)
	//   availableLiquidity = idle USDC sitting in pool
	//   totalBorrows = USDC lent out to borrowers (they owe it back)
	//   actualReserves = availableLiquidity + totalBorrows
	//
	// Solvency ratio = actualReserves / totalDeposits
	//   ~100% = healthy (all deposits are accounted for)
	//   <95%  = warning (gap between what's owed and what exists)
	//   <80%  = critical (protocol may be insolvent)

	const actualReserves = availableLiquidity + totalBorrows

	// Convert from 6 decimals (USDC) to whole dollars
	const depositsUSD = totalDeposits / 1000000n
	const actualUSD = actualReserves / 1000000n
	const liquidityUSD = availableLiquidity / 1000000n
	const borrowsUSD = totalBorrows / 1000000n

	runtime.log(`📊 Total Deposits (claimed): $${depositsUSD.toString()}`)
	runtime.log(`📊 Available Liquidity:      $${liquidityUSD.toString()}`)
	runtime.log(`📊 Total Borrows:            $${borrowsUSD.toString()}`)
	runtime.log(`📊 Actual Reserves (liq+debt):$${actualUSD.toString()}`)

	const ratio = Number(depositsUSD) > 0
		? (Number(actualUSD) * 10000) / Number(depositsUSD)
		: 10000
	const ratioPercent = ratio / 100
	runtime.log(`📈 Solvency Ratio: ${ratioPercent.toFixed(2)}%`)

	// Utilization rate (how much of deposits are lent out)
	const utilization = Number(depositsUSD) > 0
		? (Number(borrowsUSD) * 10000) / Number(depositsUSD)
		: 0
	const utilizationPercent = utilization / 100
	runtime.log(`📈 Utilization Rate: ${utilizationPercent.toFixed(2)}%`)

	// ━━━━ Risk Scoring ━━━━
	let riskScore = 0

	// Solvency risk (actual reserves vs deposits)
	if (ratio < 9500) riskScore += 30    // <95% solvency
	if (ratio < 9000) riskScore += 20    // <90% solvency
	if (ratio < 8000) riskScore += 20    // <80% solvency - major gap

	// High utilization risk (liquidity crunch)
	if (utilization > 9000) riskScore += 15  // >90% utilization
	if (utilization > 9500) riskScore += 10  // >95% utilization - bank run risk

	const anomalyDetected = ratio < 9500 || utilization > 9500 || riskScore > 50
	if (anomalyDetected && ratio < 9000) riskScore += 10

	let severity: 0 | 1 | 2
	let statusText: string

	if (ratio >= 9500 && utilization < 9000) {
		severity = 0
		statusText = 'HEALTHY'
		runtime.log('✅ Status: HEALTHY')
	} else if (ratio >= 9000 && utilization < 9500) {
		severity = 1
		statusText = 'WARNING'
		runtime.log('⚠️  Status: WARNING')
	} else {
		severity = 2
		statusText = 'CRITICAL'
		runtime.log('🚨 Status: CRITICAL')
	}

	runtime.log(`🎯 Risk Score: ${riskScore}/100`)
	runtime.log(`🔍 Anomaly: ${anomalyDetected ? 'YES' : 'NO'}`)

	// ━━━━ STEP 3: Read from Oracle on Sepolia ━━━━
	runtime.log('📡 Reading from Oracle contract on Sepolia...')

	const sepoliaNetwork = getNetwork({
		chainFamily: 'evm',
		chainSelectorName: config.chainSelector,
		isTestnet: true,
	})

	const sepoliaClient = new EVMClient(sepoliaNetwork.chainSelector.selector)

	const callData = encodeFunctionData({
		abi: RESERVE_ORACLE_ABI,
		functionName: 'totalChecks',
		args: [],
	})

	let currentChecks = 0
	let checkNumber = 1

	try {
		const contractCall = sepoliaClient
			.callContract(runtime, {
				call: encodeCallMsg({
					from: zeroAddress,
					to: config.oracleAddress as `0x${string}`,
					data: callData,
				}),
				blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
			})
			.result()

		// Check if we got valid data back
		if (contractCall.data && contractCall.data.length > 0) {
			const totalChecksData = decodeFunctionResult({
				abi: RESERVE_ORACLE_ABI,
				functionName: 'totalChecks',
				data: bytesToHex(contractCall.data),
			})
			currentChecks = Number(totalChecksData)
			checkNumber = currentChecks + 1
		} else {
			runtime.log('⚠️  Contract returned empty data, using check #1')
		}
	} catch (error) {
		runtime.log('⚠️  Could not read totalChecks, using check #1')
	}

	runtime.log(`✅ Current checks: ${currentChecks}`)
	runtime.log(`✅ Next check: #${checkNumber}`)

	// ━━━━ STEP 4: Generate & Submit Report ━━━━
	runtime.log('📝 Preparing health report...')

	const nowSeconds = BigInt(Math.floor(runtime.now() / 1000))

	const reportData = encodeAbiParameters(
		parseAbiParameters(
			'uint256 totalReservesUSD, uint256 totalClaimedUSD, uint256 globalRatio, uint256 riskScore, uint256 timestamp, uint256 checkNumber, uint8 severity, bool anomalyDetected'
		),
		[
			actualUSD,
			depositsUSD,
			BigInt(Math.floor(ratio)),
			BigInt(riskScore),
			nowSeconds,
			BigInt(checkNumber),
			severity,
			anomalyDetected,
		]
	)

	runtime.log('📝 Generating signed report via DON consensus...')

	const reportResponse = runtime
		.report({
			encodedPayload: hexToBase64(reportData),
			encoderName: 'evm',
			signingAlgo: 'ecdsa',
			hashingAlgo: 'keccak256',
		})
		.result()

	runtime.log('📤 Submitting report to Sepolia...')

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

	runtime.log(`✅ Transaction: ${txHash}`)
	runtime.log(`🔗 https://sepolia.etherscan.io/tx/${txHash}`)
	runtime.log(`📋 Check #${checkNumber} recorded on Sepolia`)
	runtime.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
	runtime.log('✅ Real Aave data monitored successfully!')

	return {
		success: true,
		protocol: config.aaveProtocol.name,
		checkNumber: checkNumber,
		reserves: {
			deposits: depositsUSD.toString(),
			liquidity: liquidityUSD.toString(),
			borrows: borrowsUSD.toString(),
			actual: actualUSD.toString(),
			solvencyRatio: ratioPercent,
			utilizationRate: utilizationPercent,
		},
		riskScore: riskScore,
		severity: statusText,
		anomalyDetected: anomalyDetected,
		txHash: txHash,
	}
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// INITIALIZATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const initWorkflow = (config: Config) => {
	const cron = new CronCapability()
	return [handler(cron.trigger({ schedule: config.schedule }), healthCheckWorkflow)]
}

export async function main() {
	const runner = await Runner.newRunner<Config>({ configSchema })
	await runner.run(initWorkflow)
}