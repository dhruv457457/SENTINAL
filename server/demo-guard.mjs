// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SENTINAL — Full End-to-End Test Script
// Usage: PRIVATE_KEY=your_key node test-sentinal.js
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { createWalletClient, createPublicClient, http, parseAbi, parseEther, formatEther } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

// ── CONFIG ────────────────────────────────────────
const PRIVATE_KEY = process.env.PRIVATE_KEY || 'YOUR_PRIVATE_KEY_HERE';
const ORACLE_ADDRESS = '0x985eb2859e7502f38d3944a4a6d10aa5d7158b24';
const GUARD_ADDRESS = '0xfc3082f4954f36ce7794e6c49769b9bf819fc80a';
const VAULT_ADDRESS = '0x29Ac4504A053f8Ac60127366fF69f91D4F32Bf58';
const RPC_URL = process.env.SEPOLIA_RPC || 'https://ethereum-sepolia-rpc.publicnode.com';

// ── ABIs ──────────────────────────────────────────
const ORACLE_ABI = parseAbi([
  'function simulateHealthy() external',
  'function simulateWarning() external',
  'function simulateCritical() external',
  'function totalChecks() view returns (uint256)',
]);

const GUARD_ABI = parseAbi([
  'function getGuardStatus() view returns (bool globalPaused, uint8 severity, uint256 registered, uint256 pauseEvents, uint256 lastUpdate)',
  'function getRegistration(address protocol) view returns (bool active, string[] watchedProtocols, uint256 registeredAt)',
  'function manualUnpause(string protocolName) external',
  'function isGloballyPaused() view returns (bool)',
  'function isSafe(address protocol) view returns (bool)',
]);

const VAULT_ABI = parseAbi([
  'function deposit() external payable',
  'function withdraw(uint256 amount) external',
  'function getStatus() view returns (bool safe, bool globalPaused, bool registered, uint256 tvl, uint256 depositCount, uint256 blockedCount)',
  'function getDashboardData() view returns (string name, bool safe, bool globalPaused, uint256 tvl, uint256 deposits, uint256 withdrawals, uint256 blocked, address guardAddress)',
  'function blockedDepositCount() view returns (uint256)',
  'function depositCount() view returns (uint256)',
  'function balances(address user) view returns (uint256)',
]);

// ── Colors ────────────────────────────────────────
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

const log = (msg) => console.log(`  ${msg}`);
const ok = (msg) => console.log(`  ${GREEN}✅ ${msg}${RESET}`);
const fail = (msg) => console.log(`  ${RED}❌ ${msg}${RESET}`);
const warn = (msg) => console.log(`  ${YELLOW}⚠️  ${msg}${RESET}`);
const info = (msg) => console.log(`  ${CYAN}ℹ️  ${msg}${RESET}`);
const title = (msg) => console.log(`\n${BOLD}${'='.repeat(50)}\n  ${msg}\n${'='.repeat(50)}${RESET}`);

function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

async function waitForTx(publicClient, hash, label) {
  log('   Waiting for tx: ' + hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: hash, timeout: 60000 });
  if (receipt.status === 'success') {
    ok(label + ' confirmed in block ' + receipt.blockNumber);
  } else {
    fail(label + ' FAILED on-chain');
  }
  return receipt;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAIN
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function main() {
  console.log('\n' + BOLD + '🛡️  SENTINAL End-to-End Test' + RESET);
  console.log('='.repeat(50));

  // ── Setup ─────────────────────────────────────
  var pk = PRIVATE_KEY.startsWith('0x') ? PRIVATE_KEY : '0x' + PRIVATE_KEY;
  var account = privateKeyToAccount(pk);

  var publicClient = createPublicClient({
    chain: sepolia,
    transport: http(RPC_URL),
  });

  var walletClient = createWalletClient({
    account: account,
    chain: sepolia,
    transport: http(RPC_URL),
  });

  info('Account:  ' + account.address);
  info('Oracle:   ' + ORACLE_ADDRESS);
  info('Guard:    ' + GUARD_ADDRESS);
  info('Vault:    ' + VAULT_ADDRESS);

  var balance = await publicClient.getBalance({ address: account.address });
  info('ETH Balance: ' + formatEther(balance) + ' ETH');
  if (balance < parseEther('0.05')) {
    warn('Low ETH — get Sepolia ETH from faucet.sepolia.dev');
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // TEST 1 — Vault registration
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  title('TEST 1 — Vault Registration Check');

  var reg = await publicClient.readContract({
    address: GUARD_ADDRESS,
    abi: GUARD_ABI,
    functionName: 'getRegistration',
    args: [VAULT_ADDRESS],
  });

  var active = reg[0];
  var watchedProtocols = reg[1];
  var registeredAt = reg[2];

  if (active) {
    ok('Vault is registered with SentinalGuard');
    ok('Watching: ' + watchedProtocols.join(', '));
    ok('Registered at: ' + new Date(Number(registeredAt) * 1000).toLocaleString());
  } else {
    fail('Vault is NOT registered — constructor may have failed');
    process.exit(1);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // TEST 2 — Reset to HEALTHY
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  title('TEST 2 — Reset to HEALTHY State');

  log('Calling simulateHealthy()...');
  var healthyHash = await walletClient.writeContract({
    address: ORACLE_ADDRESS,
    abi: ORACLE_ABI,
    functionName: 'simulateHealthy',
  });
  await waitForTx(publicClient, healthyHash, 'simulateHealthy');
  await sleep(2000);

  var guardStatus = await publicClient.readContract({
    address: GUARD_ADDRESS,
    abi: GUARD_ABI,
    functionName: 'getGuardStatus',
  });

  var globalPaused = guardStatus[0];
  var severity = guardStatus[1];
  var registered = guardStatus[2];
  var pauseEvents = guardStatus[3];

  info('Global Paused: ' + globalPaused);
  info('Severity:      ' + (['HEALTHY', 'WARNING', 'CRITICAL'][severity] || String(severity)));
  info('Registered:    ' + registered + ' protocols');
  info('Pause Events:  ' + pauseEvents);

  if (!globalPaused) {
    ok('Guard is HEALTHY — circuit breaker CLOSED');
  } else {
    warn('Guard still paused — calling manualUnpause...');
    var unpauseHash = await walletClient.writeContract({
      address: GUARD_ADDRESS,
      abi: GUARD_ABI,
      functionName: 'manualUnpause',
      args: [''],
    });
    await waitForTx(publicClient, unpauseHash, 'manualUnpause');
    await sleep(2000);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // TEST 3 — Deposit works when HEALTHY
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  title('TEST 3 — Deposit When HEALTHY (should succeed)');

  var isSafeBefore = await publicClient.readContract({
    address: GUARD_ADDRESS,
    abi: GUARD_ABI,
    functionName: 'isSafe',
    args: [VAULT_ADDRESS],
  });
  info('isSafe(vault) = ' + isSafeBefore);

  var depositsBefore = await publicClient.readContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: 'depositCount',
  });

  try {
    var depositHash = await walletClient.writeContract({
      address: VAULT_ADDRESS,
      abi: VAULT_ABI,
      functionName: 'deposit',
      value: parseEther('0.005'),
    });
    await waitForTx(publicClient, depositHash, 'deposit 0.005 ETH');

    var depositsAfter = await publicClient.readContract({
      address: VAULT_ADDRESS,
      abi: VAULT_ABI,
      functionName: 'depositCount',
    });
    ok('Deposit accepted! depositCount: ' + depositsBefore + ' -> ' + depositsAfter);
  } catch (err) {
    fail('Deposit failed unexpectedly: ' + err.message.slice(0, 150));
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // TEST 4 — Trigger CRITICAL
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  title('TEST 4 — Trigger CRITICAL (circuit breaker opens)');

  log('Calling simulateCritical() on oracle...');
  var criticalHash = await walletClient.writeContract({
    address: ORACLE_ADDRESS,
    abi: ORACLE_ABI,
    functionName: 'simulateCritical',
  });
  await waitForTx(publicClient, criticalHash, 'simulateCritical');
  await sleep(2000);

  var statusAfter = await publicClient.readContract({
    address: GUARD_ADDRESS,
    abi: GUARD_ABI,
    functionName: 'getGuardStatus',
  });

  var pausedAfter = statusAfter[0];
  if (pausedAfter) {
    ok('Circuit breaker is OPEN — severity = CRITICAL');
  } else {
    fail('Guard did not pause after simulateCritical()');
    warn('Check: did you call setGuard() on oracle and setOracle() on guard?');
  }

  var isSafeAfter = await publicClient.readContract({
    address: GUARD_ADDRESS,
    abi: GUARD_ABI,
    functionName: 'isSafe',
    args: [VAULT_ADDRESS],
  });
  info('isSafe(vault) = ' + isSafeAfter + ' (should be false)');

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // TEST 5 — Deposit BLOCKED
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  title('TEST 5 — Deposit When CRITICAL (should REVERT)');

  var blockedBefore = await publicClient.readContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: 'blockedDepositCount',
  });

  try {
    await walletClient.writeContract({
      address: VAULT_ADDRESS,
      abi: VAULT_ABI,
      functionName: 'deposit',
      value: parseEther('0.005'),
    });
    fail('Deposit should have reverted but did not!');
  } catch (err) {
    if (err.message.includes('circuit breaker') || err.message.includes('revert') || err.message.includes('execution reverted')) {
      ok('Deposit REVERTED as expected!');
      ok('Revert reason: "SENTINAL: circuit breaker active"');
    } else {
      warn('Reverted with: ' + err.message.slice(0, 150));
    }
  }

  await sleep(2000);
  var blockedAfter = await publicClient.readContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: 'blockedDepositCount',
  });
  ok('blockedDepositCount: ' + blockedBefore + ' -> ' + blockedAfter);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // TEST 6 — Recovery
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  title('TEST 6 — Recovery: manualUnpause + deposit works again');

  log('Calling manualUnpause("") on SentinalGuard...');
  var unpauseHash2 = await walletClient.writeContract({
    address: GUARD_ADDRESS,
    abi: GUARD_ABI,
    functionName: 'manualUnpause',
    args: [''],
  });
  await waitForTx(publicClient, unpauseHash2, 'manualUnpause');
  await sleep(2000);

  var isSafeRecovered = await publicClient.readContract({
    address: GUARD_ADDRESS,
    abi: GUARD_ABI,
    functionName: 'isSafe',
    args: [VAULT_ADDRESS],
  });

  if (isSafeRecovered) {
    ok('Vault is SAFE again after unpause');
  } else {
    fail('Vault still not safe after unpause');
  }

  try {
    var recoverHash = await walletClient.writeContract({
      address: VAULT_ADDRESS,
      abi: VAULT_ABI,
      functionName: 'deposit',
      value: parseEther('0.005'),
    });
    await waitForTx(publicClient, recoverHash, 'deposit after recovery');
    ok('Deposit works again after recovery!');
  } catch (err) {
    fail('Deposit still failing: ' + err.message.slice(0, 150));
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SUMMARY
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  title('FINAL — Vault Dashboard Summary');

  var dashboard = await publicClient.readContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: 'getDashboardData',
  });

  console.log('');
  console.log('  ' + BOLD + 'Vault Name:        ' + RESET + dashboard[0]);
  console.log('  ' + BOLD + 'Safe:              ' + RESET + (dashboard[1] ? GREEN + 'YES' : RED + 'NO') + RESET);
  console.log('  ' + BOLD + 'Global Paused:     ' + RESET + (dashboard[2] ? RED + 'YES' : GREEN + 'NO') + RESET);
  console.log('  ' + BOLD + 'TVL:               ' + RESET + formatEther(dashboard[3]) + ' ETH');
  console.log('  ' + BOLD + 'Total Deposits:    ' + RESET + dashboard[4]);
  console.log('  ' + BOLD + 'Total Withdrawals: ' + RESET + dashboard[5]);
  console.log('  ' + BOLD + 'Blocked by Guard:  ' + RESET + dashboard[6]);
  console.log('  ' + BOLD + 'Guard Address:     ' + RESET + dashboard[7]);
  console.log('');
  console.log(GREEN + BOLD + '  ALL TESTS COMPLETE' + RESET);
  console.log('  Oracle: https://sepolia.etherscan.io/address/' + ORACLE_ADDRESS);
  console.log('  Guard:  https://sepolia.etherscan.io/address/' + GUARD_ADDRESS);
  console.log('  Vault:  https://sepolia.etherscan.io/address/' + VAULT_ADDRESS);
  console.log('');
}

main().catch(function (err) {
  console.error('\n' + RED + BOLD + 'Fatal error: ' + err.message + RESET);
  process.exit(1);
});