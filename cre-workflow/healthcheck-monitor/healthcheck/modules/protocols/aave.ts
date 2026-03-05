// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SENTINAL — Aave V3 Protocol Reader
//
// EVM calls per chain: 2 (was 4)
//   Call A: getReserveData → aToken + debtToken addresses
//   Call B: multicall(totalSupply + balanceOf + totalSupply)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { EVMClient, Runtime, bytesToHex } from '@chainlink/cre-sdk'
import { encodeFunctionData, decodeFunctionResult } from 'viem'
import { AavePool, ERC20 } from '../../../contracts/abi'
import { evmCall } from '../evm/client'
import { multicall } from '../evm/multicall'
import type { Config, Protocol } from '../../config/schema'
import type { ProtocolResult } from '../../types'

export function readAave(
    runtime: Runtime<Config>,
    client: EVMClient,
    protocol: Protocol
): ProtocolResult {
    // ── Call A: getReserveData (1 EVM call) ──────
    const reserveCall = encodeFunctionData({
        abi: AavePool,
        functionName: 'getReserveData',
        args: [protocol.assetAddress as `0x${string}`],
    })

    const reserveData = decodeFunctionResult({
        abi: AavePool,
        functionName: 'getReserveData',
        data: bytesToHex(evmCall(client, runtime, protocol.poolAddress, reserveCall)),
    }) as any

    const aToken = reserveData.aTokenAddress as string
    const debtToken = reserveData.variableDebtTokenAddress as string

    // ── Call B: multicall(3 reads → 1 EVM call) ──
    const supplyCallData = encodeFunctionData({ abi: ERC20, functionName: 'totalSupply', args: [] })
    const balanceCallData = encodeFunctionData({
        abi: ERC20,
        functionName: 'balanceOf',
        args: [aToken as `0x${string}`],
    })

    const results = multicall(client, runtime, [
        { target: aToken, callData: supplyCallData },                // deposits
        { target: protocol.assetAddress, callData: balanceCallData },// liquidity
        { target: debtToken, callData: supplyCallData },             // borrows
    ])

    const deposits = decodeFunctionResult({
        abi: ERC20, functionName: 'totalSupply',
        data: results[0].returnData,
    }) as bigint

    const liquidity = decodeFunctionResult({
        abi: ERC20, functionName: 'balanceOf',
        data: results[1].returnData,
    }) as bigint

    const borrows = decodeFunctionResult({
        abi: ERC20, functionName: 'totalSupply',
        data: results[2].returnData,
    }) as bigint

    const d = BigInt(10 ** protocol.decimals)
    const claimedUSD = deposits / d
    const actualUSD = (liquidity + borrows) / d
    const ratio = Number(claimedUSD) > 0
        ? (Number(actualUSD) * 10000) / Number(claimedUSD)
        : 10000
    const utilizationBps = Number(claimedUSD) > 0
        ? Math.floor((Number(borrows / d) * 10000) / Number(claimedUSD))
        : 0

    return {
        name: protocol.name,
        type: 'aave',
        chain: protocol.chainName,
        claimed: claimedUSD,
        actual: actualUSD,
        solvencyRatio: ratio,
        utilizationBps,
        details: `Deposits=$${claimedUSD} | Liq=$${liquidity / d} | Borrows=$${borrows / d} | Util=${(utilizationBps / 100).toFixed(1)}%`,
    }
}