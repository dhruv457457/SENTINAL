// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SENTINAL — Lido / Compound / ERC4626 Readers
//
// Lido: 2 calls → 1 multicall
// Compound: 3 calls → 1 multicall
// ERC4626: 2 calls → 1 multicall
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { EVMClient, Runtime } from '@chainlink/cre-sdk'
import { encodeFunctionData, decodeFunctionResult } from 'viem'
import { LidoStETH, CompoundComet, ERC4626, ERC20 } from '../../../contracts/abi'
import { multicall } from '../evm/multicall'
import type { Config, Protocol } from '../../config/schema'
import type { ProtocolResult } from '../../types'

// ── Lido (1 multicall) ────────────────────────────
export function readLido(
    runtime: Runtime<Config>,
    client: EVMClient,
    protocol: Protocol
): ProtocolResult {
    const results = multicall(client, runtime, [
        {
            target: protocol.poolAddress,
            callData: encodeFunctionData({ abi: LidoStETH, functionName: 'getTotalPooledEther', args: [] }),
        },
        {
            target: protocol.poolAddress,
            callData: encodeFunctionData({ abi: LidoStETH, functionName: 'totalSupply', args: [] }),
        },
    ])

    const pooledEther = decodeFunctionResult({
        abi: LidoStETH, functionName: 'getTotalPooledEther',
        data: results[0].returnData,
    }) as bigint

    const totalStETH = decodeFunctionResult({
        abi: LidoStETH, functionName: 'totalSupply',
        data: results[1].returnData,
    }) as bigint

    const d = BigInt(10 ** protocol.decimals)
    const claimedETH = totalStETH / d
    const actualETH = pooledEther / d
    const ratio = Number(claimedETH) > 0
        ? (Number(actualETH) * 10000) / Number(claimedETH)
        : 10000
    const utilizationBps = ratio >= 10000 ? 0 : Math.floor(10000 - ratio)

    return {
        name: protocol.name,
        type: 'lido',
        chain: protocol.chainName,
        claimed: claimedETH,
        actual: actualETH,
        solvencyRatio: ratio,
        utilizationBps,
        details: `stETH=${claimedETH} ETH | Pooled=${actualETH} ETH | Backing=${(ratio / 100).toFixed(2)}%`,
    }
}

// ── Compound (1 multicall) ────────────────────────
export function readCompound(
    runtime: Runtime<Config>,
    client: EVMClient,
    protocol: Protocol
): ProtocolResult {
    const results = multicall(client, runtime, [
        {
            target: protocol.poolAddress,
            callData: encodeFunctionData({ abi: CompoundComet, functionName: 'totalSupply', args: [] }),
        },
        {
            target: protocol.poolAddress,
            callData: encodeFunctionData({ abi: CompoundComet, functionName: 'totalBorrow', args: [] }),
        },
        {
            target: protocol.assetAddress,
            callData: encodeFunctionData({
                abi: ERC20,
                functionName: 'balanceOf',
                args: [protocol.poolAddress as `0x${string}`],
            }),
        },
    ])

    const totalSupply = decodeFunctionResult({
        abi: CompoundComet, functionName: 'totalSupply',
        data: results[0].returnData,
    }) as bigint

    const totalBorrow = decodeFunctionResult({
        abi: CompoundComet, functionName: 'totalBorrow',
        data: results[1].returnData,
    }) as bigint

    const balance = decodeFunctionResult({
        abi: ERC20, functionName: 'balanceOf',
        data: results[2].returnData,
    }) as bigint

    const d = BigInt(10 ** protocol.decimals)
    const claimedUSD = totalSupply / d
    const actualUSD = (balance + totalBorrow) / d
    const ratio = Number(claimedUSD) > 0
        ? (Number(actualUSD) * 10000) / Number(claimedUSD)
        : 10000
    const utilizationBps = Number(claimedUSD) > 0
        ? Math.floor((Number(totalBorrow / d) * 10000) / Number(claimedUSD))
        : 0

    return {
        name: protocol.name,
        type: 'compound',
        chain: protocol.chainName,
        claimed: claimedUSD,
        actual: actualUSD,
        solvencyRatio: ratio,
        utilizationBps,
        details: `Supply=$${claimedUSD} | Liq=$${balance / d} | Borrows=$${totalBorrow / d} | Util=${(utilizationBps / 100).toFixed(1)}%`,
    }
}

// ── ERC4626 (1 multicall) ─────────────────────────
export function readERC4626(
    runtime: Runtime<Config>,
    client: EVMClient,
    protocol: Protocol
): ProtocolResult {
    const results = multicall(client, runtime, [
        {
            target: protocol.poolAddress,
            callData: encodeFunctionData({ abi: ERC4626, functionName: 'totalAssets', args: [] }),
        },
        {
            target: protocol.poolAddress,
            callData: encodeFunctionData({ abi: ERC4626, functionName: 'totalSupply', args: [] }),
        },
    ])

    const totalAssets = decodeFunctionResult({
        abi: ERC4626, functionName: 'totalAssets',
        data: results[0].returnData,
    }) as bigint

    const totalShares = decodeFunctionResult({
        abi: ERC4626, functionName: 'totalSupply',
        data: results[1].returnData,
    }) as bigint

    const d = BigInt(10 ** protocol.decimals)
    const claimedUSD = totalShares / d
    const actualUSD = totalAssets / d
    const ratio = Number(claimedUSD) > 0
        ? (Number(actualUSD) * 10000) / Number(claimedUSD)
        : 10000

    return {
        name: protocol.name,
        type: 'erc4626',
        chain: protocol.chainName,
        claimed: claimedUSD,
        actual: actualUSD,
        solvencyRatio: ratio,
        utilizationBps: 0,
        details: `Shares=$${claimedUSD} | Assets=$${actualUSD} | Backing=${(ratio / 100).toFixed(2)}%`,
    }
}