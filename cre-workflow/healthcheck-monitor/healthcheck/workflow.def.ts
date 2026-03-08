import {
    CronPayload,
    Runtime,
    bytesToHex,
    hexToBase64,
    HTTPClient,
    consensusMedianAggregation,
    type NodeRuntime,
} from '@chainlink/cre-sdk'
import { encodeFunctionData, decodeFunctionResult, encodeAbiParameters, parseAbiParameters } from 'viem'
import { getClient } from './modules/evm/client'
import { readProtocol } from './modules/protocols'
import { loadPolicy } from './modules/policy/secrets'
import { calculateVelocities } from './modules/risk/velocity'
import { detectContagion } from './modules/risk/contagion'
import { calculateRiskScore, calculateCrossRefRisk } from './modules/risk/scoring'
import { createDiscordAlerter } from './modules/alerts/discord'
import { decodeBody } from './modules/utils/encoding'
import type { Config } from './config/schema'
import type { ProtocolResult } from './types'

// ── Oracle ABI ────────────────────────────────────
// Matches deployed contract: returns uint256[] only
const RESERVE_ORACLE_ABI = [
    {
        inputs: [{ name: 'names', type: 'string[]' }],
        name: 'getPreviousUtilizations',
        outputs: [{ name: 'utils', type: 'uint256[]' }],
        stateMutability: 'view',
        type: 'function',
    },
] as const

// ── TVL Fetcher ───────────────────────────────────
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

// ── Manual base64 encoder — btoa not in CRE runtime ──
function toBase64(str: string): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    let result = ''
    let i = 0
    const bytes: number[] = []
    for (let c = 0; c < str.length; c++) {
        const code = str.charCodeAt(c)
        if (code < 128) {
            bytes.push(code)
        } else if (code < 2048) {
            bytes.push((code >> 6) | 192, (code & 63) | 128)
        } else {
            bytes.push((code >> 12) | 224, ((code >> 6) & 63) | 128, (code & 63) | 128)
        }
    }
    while (i < bytes.length) {
        const b0 = bytes[i++], b1 = bytes[i++], b2 = bytes[i++]
        result += chars[b0 >> 2]
        result += chars[((b0 & 3) << 4) | (b1 >> 4)]
        result += b1 !== undefined ? chars[((b1 & 15) << 2) | (b2 >> 6)] : '='
        result += b2 !== undefined ? chars[b2 & 63] : '='
    }
    return result
}

// ── Previous Utils Fetcher (HTTP eth_call) ────────
// Uses HTTPClient + eth_call — callContract returns 0x in simulator
function createPrevUtilsFetcher(oracleAddress: string, callData: string) {
    return (nodeRuntime: NodeRuntime<Config>): bigint[] => {
        const httpClient = new HTTPClient()

        const bodyStr = JSON.stringify({
            jsonrpc: '2.0',
            method: 'eth_call',
            params: [{ to: oracleAddress, data: callData }, 'latest'],
            id: 1,
        })

        const response = httpClient
            .sendRequest(nodeRuntime, {
                url: 'https://ethereum-sepolia-rpc.publicnode.com',
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: toBase64(bodyStr),
            })
            .result()

        const bodyRes = decodeBody(response.body)
        const json = JSON.parse(bodyRes)

        if (!json.result || json.result === '0x') return []

        const decoded = decodeFunctionResult({
            abi: RESERVE_ORACLE_ABI,
            functionName: 'getPreviousUtilizations',
            data: json.result as `0x${string}`,
        }) as bigint[]

        return [...decoded]
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAIN WORKFLOW
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function healthCheckWorkflow(
    runtime: Runtime<Config>,
    _payload: CronPayload
): Record<string, unknown> {
    const config = runtime.config

    const chainSet: string[] = []
    for (const p of config.protocols) {
        if (chainSet.indexOf(p.chainName) === -1) chainSet.push(p.chainName)
    }

    runtime.log('🚀 SENTINAL Multi-Chain DeFi Risk Monitoring')
    runtime.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    runtime.log('📋 Capabilities: Cron | EVM Read | HTTP | Consensus | EVM Write | DON Time')
    runtime.log(`📊 Monitoring ${config.protocols.length} protocols across ${chainSet.length} chains`)
    runtime.log(`🔗 Chains: ${chainSet.join(', ')}`)

    // ═══════════════════════════════════════════════
    // STEP 1: LOAD CONFIDENTIAL POLICY
    // ═══════════════════════════════════════════════

    runtime.log('')
    runtime.log('🔐 STEP 1: Load Confidential Policy [runtime.getSecret()]')

    const { policy, policyHash, fromSecret } = loadPolicy(runtime)
    const thresholds = policy.thresholds

    runtime.log(`   ${fromSecret ? '🔒 Policy loaded from CRE secret store' : '⚠️  Using fallback policy (configure SENTINAL_POLICY_CONFIG secret)'}`)
    runtime.log(`   📋 Policy version: ${policy.version}`)
    runtime.log(`   🔑 Policy hash: ${policyHash.slice(0, 18)}...`)
    runtime.log(`   🎯 Velocity threshold: ${(thresholds.velocityAlertBps / 100).toFixed(1)}%/cycle`)
    runtime.log(`   🎯 Solvency warning: ${(thresholds.solvencyWarningBps / 100).toFixed(0)}%`)

    // ═══════════════════════════════════════════════
    // STEP 2: MULTI-CHAIN ONCHAIN READS (Calls 1-7)
    // ═══════════════════════════════════════════════

    runtime.log('')
    runtime.log('📡 STEP 2: Onchain Data [EVM Read — Multicall3 Batched] (Calls 1-7)')

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
    // STEP 3: OFFCHAIN TVL — HTTP + DON CONSENSUS
    // ═══════════════════════════════════════════════

    runtime.log('🌐 STEP 3: Offchain TVL [HTTP + DON Consensus]')

    const slugs: string[] = []
    for (const p of config.protocols) {
        if (slugs.indexOf(p.defiLlamaSlug) === -1) slugs.push(p.defiLlamaSlug)
    }
    slugs.sort()

    const tvlBySlug: Record<string, bigint> = {}
    for (const slug of slugs) {
        const fetcher = createTVLFetcher(slug)
        const tvl = runtime.runInNodeMode(fetcher, consensusMedianAggregation<bigint>())().result()
        tvlBySlug[slug] = tvl
        runtime.log(`   ✅ ${slug}: $${tvl.toString()}`)
    }

    const tvlMap: Record<string, bigint> = {}
    for (const protocol of config.protocols) {
        tvlMap[protocol.name] = tvlBySlug[protocol.defiLlamaSlug] ?? 0n
    }

    // ═══════════════════════════════════════════════
    // STEP 4: PREVIOUS UTILIZATIONS (Call 8)
    // HTTPClient eth_call — bypasses callContract 0x bug
    // ═══════════════════════════════════════════════

    runtime.log('')
    runtime.log('📡 STEP 4: Previous Utilizations [Call 8 — Sepolia eth_call]')

    const sepoliaClient = getClient(config.chainSelector, true)
    const checkNumber = Math.floor(runtime.now() / 1000) % 100000
    const protocolNames = config.protocols.map(p => p.name)
    let previousUtils: bigint[] = config.protocols.map(() => 0n)
    let isFirstRun = true

    try {
        const prevUtilCallData = encodeFunctionData({
            abi: RESERVE_ORACLE_ABI,
            functionName: 'getPreviousUtilizations',
            args: [protocolNames],
        })

        const fetcher = createPrevUtilsFetcher(config.oracleAddress, prevUtilCallData)
        const utils = runtime.runInNodeMode(
            fetcher,
            consensusMedianAggregation<bigint[]>()
        )().result()

        if (utils.length === protocolNames.length) {
            previousUtils = utils
            isFirstRun = utils.every(v => v === 0n)

            if (isFirstRun) {
                runtime.log('   ℹ️  First run — seeding baseline')
            } else {
                runtime.log(`   ✅ Previous utilizations loaded (${utils.length} protocols)`)
                for (let i = 0; i < protocolNames.length; i++) {
                    runtime.log(`   📊 ${protocolNames[i]}: prev=${(Number(utils[i]) / 100).toFixed(1)}%`)
                }
            }
        } else if (utils.length === 0) {
            runtime.log('   ℹ️  No previous data — seeding baseline')
        } else {
            runtime.log(`   ⚠️  Length mismatch (got ${utils.length}, expected ${protocolNames.length}) — treating as first run`)
        }
    } catch (e: any) {
        runtime.log(`   ⚠️  Could not read previous utilizations — treating as first run`)
        runtime.log(`   ⚠️  Error: ${e?.message ?? String(e)}`)
        isFirstRun = true
    }

    // ═══════════════════════════════════════════════
    // STEP 5: VELOCITY DETECTION
    // ═══════════════════════════════════════════════

    runtime.log('')
    runtime.log(`⚡ STEP 5: Velocity Detection${isFirstRun ? ' [BASELINE]' : ''}`)

    const velocities = calculateVelocities(results, previousUtils, isFirstRun, thresholds)
    const velocityAlerts = velocities.filter(v => v.isAlert)

    for (const v of velocities) {
        if (isFirstRun) {
            runtime.log(`   📌 ${v.name}: Util=${(v.currentUtilBps / 100).toFixed(1)}% (baseline)`)
        } else {
            const dir = v.velocityNegative ? '▼' : '▲'
            const tag = v.isAlert ? '⚡ ALERT' : '✅'
            runtime.log(`   ${tag} ${v.name}: ${(v.prevUtilBps / 100).toFixed(1)}% → ${(v.currentUtilBps / 100).toFixed(1)}% ${dir} (${(v.velocityBps / 100).toFixed(1)}%/cycle)`)
        }
    }

    // ═══════════════════════════════════════════════
    // STEP 6: CROSS-CHAIN CONTAGION DETECTION
    // ═══════════════════════════════════════════════

    runtime.log('')
    runtime.log('🔗 STEP 6: Cross-Chain Contagion Detection')

    const contagion = detectContagion(results, velocities, isFirstRun, thresholds)

    if (contagion.detected) {
        runtime.log(`   🚨 CONTAGION DETECTED: ${contagion.description}`)
        runtime.log(`   📊 Affected chains: ${contagion.affectedChains.join(', ')}`)
        runtime.log(`   📊 Correlated velocity: ${(contagion.correlatedVelocity / 100).toFixed(1)}%/cycle`)
        runtime.log(`   ⬆️  Tier escalation: +${contagion.tierEscalation} risk`)
    } else {
        runtime.log(`   ✅ ${contagion.description}`)
    }

    // ═══════════════════════════════════════════════
    // STEP 7: CROSS-REFERENCE + RISK SCORING
    // ═══════════════════════════════════════════════

    runtime.log('')
    runtime.log('🔍 STEP 7: Cross-Reference Analysis')

    const crossRefRisk = calculateCrossRefRisk(results, tvlMap, thresholds, runtime)

    runtime.log('')
    runtime.log('🎯 STEP 8: Risk Assessment [Confidential Policy + Contagion]')

    const {
        riskScore,
        worstSolvency,
        worstProtocol,
        severity,
        statusText,
        anomalyDetected,
    } = calculateRiskScore(results, velocities, contagion, crossRefRisk, isFirstRun, thresholds)

    runtime.log(`   Status:        ${statusText}`)
    runtime.log(`   Risk Score:    ${riskScore}/100`)
    runtime.log(`   Worst:         ${worstProtocol} (${(worstSolvency / 100).toFixed(2)}%)`)
    runtime.log(`   Contagion:     ${contagion.detected ? '🔴 YES' : '✅ NO'}`)
    runtime.log(`   Policy:        ${policy.version} | ${policyHash.slice(0, 18)}...`)
    runtime.log(`   Anomaly:       ${anomalyDetected ? 'YES 🔴' : 'NO ✅'}`)

    // ═══════════════════════════════════════════════
    // STEP 9: SUBMIT REPORT WITH POLICY HASH (Call 9)
    // ═══════════════════════════════════════════════

    runtime.log('')
    runtime.log('📤 STEP 9: Submit Attested Report [EVM Write + policyHash] (Call 9)')

    const nowSeconds = BigInt(Math.floor(runtime.now() / 1000))

    let totalClaimedUSD = 0n
    let totalActualUSD = 0n
    for (const r of results) {
        if (r.type === 'aave' || r.type === 'compound' || r.type === 'erc4626') {
            totalClaimedUSD += r.claimed
            totalActualUSD += r.actual
        }
    }

    const policyHashBytes32 = policyHash as `0x${string}`

    const reportData = encodeAbiParameters(
        parseAbiParameters(
            'uint256 totalReservesUSD, uint256 totalClaimedUSD, uint256 globalRatio, uint256 riskScore, uint256 timestamp, uint256 checkNumber, uint8 severity, bool anomalyDetected, bytes32 policyHash'
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
            policyHashBytes32,
        ]
    )

    runtime.log('   📝 Generating DON-signed report with policyHash...')

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
gasConfig: { gasLimit: '1000000' },
        })
        .result()

    const txHash = bytesToHex(writeResult.txHash || new Uint8Array(32))
    runtime.log(`   ✅ Report submitted: ${txHash}`)
    runtime.log(`   🔑 Policy binding: ${policyHash.slice(0, 18)}...`)

    // ═══════════════════════════════════════════════
    // STEP 10: DISCORD ALERT (HTTP POST)
    // ═══════════════════════════════════════════════

    if (config.discordWebhookUrl) {
        runtime.log('')
        runtime.log('🔔 STEP 10: Discord Alert [HTTP POST]')

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
            velocityAlerts,
            contagion,
            policyHash,
            policyVersion: policy.version,
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
    runtime.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    runtime.log('✅ SENTINAL Health Check Complete!')
    runtime.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

    for (const r of results) {
        const emoji = r.solvencyRatio >= thresholds.solvencyWarningBps ? '✅'
            : r.solvencyRatio >= thresholds.solvencyCriticalBps ? '⚠️' : '🚨'
        const v = velocities.find(x => x.name === r.name)
        const velStr = (!isFirstRun && v?.isAlert)
            ? ` ⚡+${(v.velocityBps / 100).toFixed(1)}%`
            : ''
        const contagionTag = contagion.affectedProtocols.includes(r.name) ? ' 🔗CONTAGION' : ''
        runtime.log(`   ${emoji} ${r.name}: ${(r.solvencyRatio / 100).toFixed(2)}%${velStr}${contagionTag}`)
    }

    runtime.log(`   🔗 Chains:       ${chainSet.length} (${chainSet.join(', ')})`)
    runtime.log(`   📊 Protocols:    ${results.length}`)
    runtime.log(`   💰 Reserves:     $${totalActualUSD}`)
    runtime.log(`   ⚡ Velocity:     ${isFirstRun ? 'baseline seeded' : `${velocityAlerts.length} alert(s)`}`)
    runtime.log(`   🔗 Contagion:    ${contagion.detected ? `YES — ${contagion.affectedChains.length} chains` : 'NO'}`)
    runtime.log(`   🔒 Policy:       ${policy.version} (${fromSecret ? 'confidential' : 'fallback'})`)
    runtime.log(`   📋 policyHash:   ${policyHash.slice(0, 18)}...`)
    runtime.log(`   Risk:            ${riskScore}/100 — ${statusText}`)
    runtime.log(`   Tx:              ${txHash}`)
    runtime.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

    return {
        success: true,
        checkNumber,
        isFirstRun,
        chains: chainSet,
        policy: {
            version: policy.version,
            hash: policyHash,
            fromSecret,
        },
        protocols: results.map((r, i) => ({
            name: r.name,
            type: r.type,
            chain: r.chain,
            solvency: (r.solvencyRatio / 100).toFixed(2),
            utilizationBps: r.utilizationBps,
            velocityBps: isFirstRun ? 0 : velocities[i].velocityBps,
            velocityNegative: velocities[i].velocityNegative,
            velocityAlert: isFirstRun ? false : velocities[i].isAlert,
            contagionAffected: contagion.affectedProtocols.includes(r.name),
            details: r.details,
        })),
        contagion: {
            detected: contagion.detected,
            affectedChains: contagion.affectedChains,
            tierEscalation: contagion.tierEscalation,
            description: contagion.description,
        },
        aggregate: {
            totalClaimedUSD: totalClaimedUSD.toString(),
            totalActualUSD: totalActualUSD.toString(),
            worstSolvency: (worstSolvency / 100).toFixed(2),
            worstProtocol,
        },
        // FIX: include offchain TVL so runner summary can display it
        offchain: [
            { slug: 'aave-v3', tvl: (tvlBySlug['aave-v3'] ?? 0n).toString() },
            { slug: 'lido',    tvl: (tvlBySlug['lido']    ?? 0n).toString() },
        ],
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
        policyHash,
        txHash,
    }
}