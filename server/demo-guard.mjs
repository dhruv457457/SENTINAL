#!/usr/bin/env node
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SENTINAL Guard Demo Script
// Demonstrates the circuit breaker end-to-end:
//   1. Register your address on SentinalGuard
//   2. Confirm isSafe = true (normal state)
//   3. Trigger simulateCritical on oracle
//   4. Guard auto-pauses via oracle hook
//   5. Confirm isSafe = false (circuit breaker fired)
//   6. Trigger simulateHealthy to recover
//   7. Confirm isSafe = true again (recovered)
//
// Usage: node scripts/demo-guard.mjs
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import 'dotenv/config';
import { createWalletClient, createPublicClient, http, parseAbi } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONFIG
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const ORACLE_ADDRESS = process.env.ORACLE_ADDRESS || '0x71f540d7dac0fc71b6652b1d8aee9012638095ca';
const GUARD_ADDRESS = process.env.GUARD_ADDRESS || '0xf9955c8b6e62eab7ab7fbedb4a2e90b6f6ad3905';
const SEPOLIA_RPC = process.env.SEPOLIA_RPC || 'https://ethereum-sepolia-rpc.publicnode.com';
const PRIVATE_KEY = process.env.PRIVATE_KEY;

if (!PRIVATE_KEY) {
  console.error('❌  PRIVATE_KEY not set in .env');
  process.exit(1);
}

const pk = PRIVATE_KEY.startsWith('0x') ? PRIVATE_KEY : `0x${PRIVATE_KEY}`;
const account = privateKeyToAccount(pk);

const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(SEPOLIA_RPC),
});

const walletClient = createWalletClient({
  account,
  chain: sepolia,
  transport: http(SEPOLIA_RPC),
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ABIs
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const GUARD_ABI = parseAbi([
  'function register(string[] watchedProtocols) external',
  'function deregister() external',
  'function isSafe(address protocol) view returns (bool)',
  'function isGloballyPaused() view returns (bool)',
  'function isProtocolSafe(string name) view returns (bool)',
  'function totalRegistered() view returns (uint256)',
  'function getRegistration(address protocol) view returns (bool active, string[] watchedProtocols, uint256 registeredAt)',
  'function getGuardStatus() view returns (bool globalPaused, uint8 severity, uint256 registered, uint256 pauseEvents, uint256 lastUpdate)',
  'function getProtocolStatus(string name) view returns (bool paused, bool warning, uint256 solvency, uint256 lastCheckNumber, uint256 lastUpdated)',
  'function manualUnpause(string protocolName) external',
]);

const ORACLE_ABI = parseAbi([
  'function simulateHealthy() external',
  'function simulateWarning() external',
  'function simulateCritical() external',
  'function totalChecks() view returns (uint256)',
]);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HELPERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function send(contractAddress, abi, functionName, args = [], label = '') {
  console.log(`\n   ⏳ Sending: ${label || functionName}...`);
  const hash = await walletClient.writeContract({
    address: contractAddress,
    abi,
    functionName,
    args,
  });
  console.log(`   📝 Tx: https://sepolia.etherscan.io/tx/${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (receipt.status === 'reverted') throw new Error(`Transaction reverted: ${hash}`);
  console.log(`   ✅ Confirmed in block ${receipt.blockNumber}`);
  return receipt;
}

async function read(contractAddress, abi, functionName, args = []) {
  return publicClient.readContract({ address: contractAddress, abi, functionName, args });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function severityLabel(n) {
  return ['HEALTHY', 'WARNING', 'CRITICAL'][n] || 'UNKNOWN';
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAIN DEMO
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function main() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🛡️  SENTINAL Circuit Breaker Demo');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`   Wallet:  ${account.address}`);
  console.log(`   Oracle:  ${ORACLE_ADDRESS}`);
  console.log(`   Guard:   ${GUARD_ADDRESS}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // ── STEP 1: Initial state ───────────────────────
  console.log('📊 STEP 1: Reading initial guard state...');

  const totalChecks = await read(ORACLE_ADDRESS, ORACLE_ABI, 'totalChecks');
  const guardStatus = await read(GUARD_ADDRESS, GUARD_ABI, 'getGuardStatus');
  const totalRegistered = await read(GUARD_ADDRESS, GUARD_ABI, 'totalRegistered');

  console.log(`   Oracle checks:     ${totalChecks}`);
  console.log(`   Guard severity:    ${severityLabel(guardStatus[1])}`);
  console.log(`   Guard paused:      ${guardStatus[0]}`);
  console.log(`   Total registered:  ${totalRegistered}`);

  // ── STEP 2: Register ────────────────────────────
  console.log('\n📋 STEP 2: Registering your address on SentinalGuard...');
  console.log('   Watching: ["Aave V3 USDC (Ethereum)", "Lido stETH"]');

  // Check if already registered
  const existingReg = await read(GUARD_ADDRESS, GUARD_ABI, 'getRegistration', [account.address]);
  if (existingReg[0]) {
    console.log('   ℹ️  Already registered — skipping register() tx');
  } else {
    await send(
      GUARD_ADDRESS, GUARD_ABI, 'register',
      [['Aave V3 USDC (Ethereum)', 'Lido stETH']],
      'register()'
    );
  }

  // Verify registration
  const reg = await read(GUARD_ADDRESS, GUARD_ABI, 'getRegistration', [account.address]);
  console.log(`\n   ✅ Registered: ${reg[0]}`);
  console.log(`   Watching:    [${reg[1].join(', ')}]`);

  // ── STEP 3: Confirm isSafe = true ───────────────
  console.log('\n🟢 STEP 3: Checking safety BEFORE critical event...');

  const safeBefore = await read(GUARD_ADDRESS, GUARD_ABI, 'isSafe', [account.address]);
  const pausedBefore = await read(GUARD_ADDRESS, GUARD_ABI, 'isGloballyPaused');
  const aaveSafeBefore = await read(GUARD_ADDRESS, GUARD_ABI, 'isProtocolSafe', ['Aave V3 USDC (Ethereum)']);
  const lidoSafeBefore = await read(GUARD_ADDRESS, GUARD_ABI, 'isProtocolSafe', ['Lido stETH']);

  console.log(`   isSafe(your address):              ${safeBefore ? '✅ SAFE' : '🚨 UNSAFE'}`);
  console.log(`   isGloballyPaused():                ${pausedBefore ? '🚨 PAUSED' : '✅ NOT PAUSED'}`);
  console.log(`   isProtocolSafe(Aave V3 USDC ETH):  ${aaveSafeBefore ? '✅ SAFE' : '🚨 UNSAFE'}`);
  console.log(`   isProtocolSafe(Lido stETH):        ${lidoSafeBefore ? '✅ SAFE' : '🚨 UNSAFE'}`);

  // ── STEP 4: Trigger CRITICAL ────────────────────
  console.log('\n🚨 STEP 4: Triggering simulateCritical() on oracle...');
  console.log('   This simulates a catastrophic reserve shortfall.');
  console.log('   Oracle will call guard.updateGlobalStatus(2) internally.\n');

  await send(ORACLE_ADDRESS, ORACLE_ABI, 'simulateCritical', [], 'simulateCritical()');

  // Small wait for state to settle
  await sleep(2000);

  // ── STEP 5: Confirm isSafe = false ──────────────
  console.log('\n🔴 STEP 5: Checking safety AFTER critical event...');

  const safeAfter = await read(GUARD_ADDRESS, GUARD_ABI, 'isSafe', [account.address]);
  const pausedAfter = await read(GUARD_ADDRESS, GUARD_ABI, 'isGloballyPaused');
  const aaveSafeAfter = await read(GUARD_ADDRESS, GUARD_ABI, 'isProtocolSafe', ['Aave V3 USDC (Ethereum)']);
  const guardAfter = await read(GUARD_ADDRESS, GUARD_ABI, 'getGuardStatus');

  console.log(`   isSafe(your address):   ${safeAfter ? '✅ SAFE' : '🚨 UNSAFE — CIRCUIT BREAKER FIRED!'}`);
  console.log(`   isGloballyPaused():     ${pausedAfter ? '🚨 PAUSED' : '✅ NOT PAUSED'}`);
  console.log(`   isProtocolSafe(Aave):   ${aaveSafeAfter ? '✅ SAFE' : '🚨 UNSAFE'}`);
  console.log(`   Guard severity:         ${severityLabel(guardAfter[1])}`);
  console.log(`   Pause events total:     ${guardAfter[3]}`);

  if (!safeAfter) {
    console.log('\n   🎯 CIRCUIT BREAKER CONFIRMED WORKING!');
    console.log('   Any protocol that integrates isSafe() would now block deposits/withdrawals.');
  }

  // ── STEP 6: Recovery via manualUnpause (owner only) ────
  console.log('\n💚 STEP 6: Recovering via manualUnpause...');

  const hash = await walletClient.writeContract({
    address: GUARD_ADDRESS,
    abi: GUARD_ABI,
    functionName: 'manualUnpause',
    args: [''], // empty string = unpause global
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`   ✅ Confirmed in block ${receipt.blockNumber}`);

  // ── STEP 7: Verify recovered ────────────────────
  const safeRecovered = await publicClient.readContract({
    address: GUARD_ADDRESS,
    abi: GUARD_ABI,
    functionName: 'isSafe',
    args: [account.address],
  });
  console.log(`   isSafe after recovery: ${safeRecovered ? '✅ SAFE — RECOVERED!' : '🚨 STILL UNSAFE'}`);

  const pausedRecovered = await read(GUARD_ADDRESS, GUARD_ABI, 'isGloballyPaused');
  const guardRecovered = await read(GUARD_ADDRESS, GUARD_ABI, 'getGuardStatus');

  // ── STEP 8: Per-protocol check ──────────────────
  console.log('\n🔍 STEP 8: Per-protocol status check...');

  const protocols = [
    'Aave V3 USDC (Ethereum)',
    'Aave V3 USDC (Arbitrum)',
    'Aave V3 USDC (Base)',
    'Lido stETH',
  ];

  for (const name of protocols) {
    try {
      const status = await read(GUARD_ADDRESS, GUARD_ABI, 'getProtocolStatus', [name]);
      const solvencyPct = (Number(status[2]) / 100).toFixed(2);
      const tag = status[0] ? '🚨 PAUSED' : status[1] ? '⚠️  WARNING' : '✅ SAFE';
      console.log(`   ${tag} ${name}`);
      console.log(`         Solvency: ${solvencyPct}% | Check #${status[3]}`);
    } catch {
      console.log(`   ⚪ ${name}: no data yet`);
    }
  }

  // ── FINAL SUMMARY ───────────────────────────────
  const finalChecks = await read(ORACLE_ADDRESS, ORACLE_ABI, 'totalChecks');

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🎉 SENTINAL Circuit Breaker Demo Complete!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`   Oracle total checks:   ${finalChecks}`);
  console.log(`   Guard pause events:    ${guardRecovered[3]}`);
  console.log(`   Your address safe:     ${safeRecovered}`);
  console.log('');
  console.log('   Etherscan links:');
  console.log(`   Oracle:  https://sepolia.etherscan.io/address/${ORACLE_ADDRESS}`);
  console.log(`   Guard:   https://sepolia.etherscan.io/address/${GUARD_ADDRESS}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main().catch(err => {
  console.error('\n❌ Demo failed:', err.message || err);
  process.exit(1);
});
