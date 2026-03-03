#!/usr/bin/env node
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SENTINAL Runner — Continuous Loop with Full Logs
// Usage: node scripts/run-and-report.mjs
//        node scripts/run-and-report.mjs --broadcast
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { spawn } from 'child_process';

const SERVER_URL = process.env.SENTINAL_SERVER || 'http://localhost:3001';
const broadcast = process.argv.includes('--broadcast');
const DELAY_MS = 60 * 1000;
const WORKFLOW_DIR = './cre-workflow/healthcheck-monitor';

// ── Colors ────────────────────────────────────────
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  white: '\x1b[37m',
};

const ok = (m) => console.log(`${C.green}  ✅ ${m}${C.reset}`);
const fail = (m) => console.log(`${C.red}  ❌ ${m}${C.reset}`);
const warn = (m) => console.log(`${C.yellow}  ⚠️  ${m}${C.reset}`);
const info = (m) => console.log(`${C.cyan}  ℹ️  ${m}${C.reset}`);
const dim = (m) => console.log(`${C.dim}${m}${C.reset}`);
const bold = (m) => console.log(`${C.bold}${m}${C.reset}`);
const sep = () => console.log(`${C.dim}${'━'.repeat(60)}${C.reset}`);
const gap = () => console.log('');

// ── Helpers ───────────────────────────────────────

function nowStr() {
  return new Date().toLocaleTimeString();
}

const CHAIN_LABELS = {
  'ethereum-mainnet': 'Ethereum',
  'ethereum-mainnet-arbitrum-1': 'Arbitrum',
  'ethereum-mainnet-base-1': 'Base',
  'ethereum-testnet-sepolia': 'Sepolia',
};

function chainLabel(c) {
  return CHAIN_LABELS[c] || c;
}

function formatUSD(num) {
  const n = Number(num);
  if (isNaN(n)) return '$0';
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toLocaleString('en-US')}`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// BANNER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function banner() {
  console.clear();
  console.log(`${C.bold}${C.green}`);
  console.log('  ╔══════════════════════════════════════════════════════╗');
  console.log('  ║           🛡️  SENTINAL — DEFI HEALTH MONITOR          ║');
  console.log('  ║        Powered by Chainlink CRE · Multi-Chain         ║');
  console.log('  ╚══════════════════════════════════════════════════════╝');
  console.log(C.reset);
  info(`Server:    ${SERVER_URL}`);
  info(`Interval:  ${DELAY_MS / 1000}s`);
  info(`Mode:      ${broadcast ? C.yellow + 'BROADCAST (Real TXs)' : C.green + 'SIMULATE'}${C.reset}`);
  info(`Workflow:  ${WORKFLOW_DIR}`);
  gap();
  if (broadcast) {
    console.log(`  ${C.bold}${C.yellow}⚠️  BROADCAST MODE — Real transactions will be sent!${C.reset}`);
    gap();
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RUN CRE WORKFLOW — streaming live
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function runWorkflow() {
  return new Promise((resolve) => {
    const args = ['workflow', 'simulate', 'healthcheck'];
    if (broadcast) args.push('--broadcast');

    sep();
    bold(`  🚀 CRE WORKFLOW — Check at ${nowStr()}`);
    sep();
    gap();

    const proc = spawn('cre', args, {
      cwd: WORKFLOW_DIR,
      shell: true,
    });

    let fullOutput = '';
    let resultJson = null;

    proc.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      fullOutput += text;

      const lines = text.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;

        const stripped = line
          .replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z \[USER LOG\] /, '')
          .replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z \[SIMULATION\] /, `${C.dim}[SIM] `);

        if (line.includes('Workflow Simulation Result')) {
          gap();
          console.log(`  ${C.bold}${C.cyan}📊 WORKFLOW RESULT JSON:${C.reset}`);
        } else if (
          line.includes('Simulation complete') ||
          line.includes('cre account') ||
          line.includes('╭') || line.includes('╰') ||
          line.includes('│ ')
        ) {
          // suppress cre promo box
        } else if (line.includes('✅') || line.includes('Complete') || line.includes('HEALTHY')) {
          console.log(`  ${C.green}${stripped}${C.reset}`);
        } else if (line.includes('❌') || line.includes('CRITICAL') || line.includes('failed')) {
          console.log(`  ${C.red}${stripped}${C.reset}`);
        } else if (line.includes('⚠️') || line.includes('WARNING') || line.includes('⚡')) {
          console.log(`  ${C.yellow}${stripped}${C.reset}`);
        } else if (line.includes('STEP') || line.includes('━━')) {
          console.log(`  ${C.cyan}${C.bold}${stripped}${C.reset}`);
        } else if (line.includes('Tx:') || (line.includes('0x') && line.length > 30 && !line.includes('Onchain'))) {
          console.log(`  ${C.magenta}${stripped}${C.reset}`);
        } else if (line.includes('Risk Score') || line.includes('Solvency') || line.includes('Util')) {
          console.log(`  ${C.blue}${stripped}${C.reset}`);
        } else if (line.includes('[SIM]')) {
          console.log(`${C.dim}  ${stripped}${C.reset}`);
        } else {
          console.log(`  ${stripped}`);
        }
      }
    });

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      if (text.includes('Update available') || text.includes('update')) {
        dim(`  [cre update available — run: cre update]`);
        return;
      }
      if (text.includes('Warning:')) {
        warn(text.trim());
        return;
      }
      if (text.includes('DeprecationWarning') || text.includes('ExperimentalWarning')) return;
      process.stderr.write(`${C.red}${text}${C.reset}`);
    });

    proc.on('close', (code) => {
      gap();

      const jsonMatch = fullOutput.match(/Workflow Simulation Result:\s*\n\s*(\{[\s\S]*?\n\})/);
      if (jsonMatch) {
        try {
          resultJson = JSON.parse(jsonMatch[1]);
        } catch {
          warn('Could not parse workflow JSON result');
        }
      }

      if (code !== 0 && !resultJson) {
        fail(`Workflow exited with code ${code}`);
        sep();
        resolve(null);
        return;
      }

      if (resultJson) {
        sep();
        bold(`  📊 SENTINAL SUMMARY — Check #${resultJson.checkNumber}`);
        sep();
        gap();

        const severityColor = resultJson.severity === 'HEALTHY' ? C.green
          : resultJson.severity === 'WARNING' ? C.yellow : C.red;

        const chainNames = resultJson.chains.map(chainLabel).join(', ');
        const reservesStr = formatUSD(resultJson.aggregate.totalActualUSD);
        const tvlAave = formatUSD(resultJson.offchain?.find(o => o.slug === 'aave-v3')?.tvl || 0);
        const tvlLido = formatUSD(resultJson.offchain?.find(o => o.slug === 'lido')?.tvl || 0);
        const totalTVL = formatUSD(
          (Number(resultJson.offchain?.find(o => o.slug === 'aave-v3')?.tvl || 0) +
            Number(resultJson.offchain?.find(o => o.slug === 'lido')?.tvl || 0))
        );

        console.log(`  ${C.bold}Status:${C.reset}       ${severityColor}${C.bold}${resultJson.severity}${C.reset}`);
        console.log(`  ${C.bold}Risk Score:${C.reset}   ${severityColor}${resultJson.riskScore}/100${C.reset}`);
        console.log(`  ${C.bold}Anomaly:${C.reset}      ${resultJson.anomalyDetected ? C.red + '🔴 YES' : C.green + '✅ NO'}${C.reset}`);
        console.log(`  ${C.bold}Chains:${C.reset}       ${resultJson.chains.length} — ${C.cyan}${chainNames}${C.reset}`);
        console.log(`  ${C.bold}Protocols:${C.reset}    ${resultJson.protocols.length}`);
        console.log(`  ${C.bold}Reserves:${C.reset}     ${C.green}${C.bold}${reservesStr}${C.reset} onchain`);
        console.log(`  ${C.bold}Aave TVL:${C.reset}     ${tvlAave} (DeFiLlama)`);
        console.log(`  ${C.bold}Lido TVL:${C.reset}     ${tvlLido} (DeFiLlama)`);
        console.log(`  ${C.bold}Total TVL:${C.reset}    ${C.cyan}${totalTVL}${C.reset} monitored`);
        console.log(`  ${C.bold}First Run:${C.reset}    ${resultJson.isFirstRun ? C.yellow + 'YES — seeding baseline' : C.green + 'NO — velocity active'}${C.reset}`);

        gap();
        bold('  PROTOCOL STATUS:');
        gap();

        for (const p of resultJson.protocols) {
          const sol = parseFloat(p.solvency);
          const pColor = sol >= 99 ? C.green : sol >= 90 ? C.yellow : C.red;
          const util = p.utilizationBps ? (p.utilizationBps / 100).toFixed(1) : '0.0';
          const chain = chainLabel(p.chain);
          const velStr = p.velocityAlert
            ? ` ${C.yellow}⚡ +${(p.velocityBps / 100).toFixed(1)}%${C.reset}`
            : '';
          console.log(
            `  ${pColor}●${C.reset} ${p.name.padEnd(34)}${C.dim}[${chain}]${C.reset}` +
            `  ${pColor}${p.solvency}%${C.reset}  util ${util}%${velStr}`
          );
        }

        if (resultJson.velocityAlerts?.length > 0) {
          gap();
          bold('  ⚡ VELOCITY ALERTS:');
          for (const v of resultJson.velocityAlerts) {
            const dir = v.velocityNegative ? '▼' : '▲';
            console.log(`  ${C.yellow}  ${dir} ${v.name}: ${(v.velocityBps / 100).toFixed(1)}%/cycle → util now ${(v.currentUtilBps / 100).toFixed(1)}%${C.reset}`);
          }
        }

        gap();
        if (resultJson.txHash && !resultJson.txHash.startsWith('0x0000000000')) {
          console.log(`  ${C.bold}TX:${C.reset}  ${C.magenta}${resultJson.txHash}${C.reset}`);
          console.log(`  ${C.dim}       https://sepolia.etherscan.io/tx/${resultJson.txHash}${C.reset}`);
        }
        gap();
      }

      resolve(resultJson);
    });
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POST TO SERVER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function postToServer(result) {
  sep();
  bold('  📡 SYNCING TO SENTINAL SERVER');
  sep();
  gap();

  try {
    const res = await fetch(`${SERVER_URL}/api/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    });

    if (res.ok) {
      const data = await res.json();
      ok(`Stored as Check #${data.checkNumber}`);

      if (data.onchain?.hash) {
        ok(`Protocol data submitted onchain`);
        console.log(`  ${C.dim}  TX:    ${data.onchain.hash}${C.reset}`);
        console.log(`  ${C.dim}  Block: ${data.onchain.blockNumber}${C.reset}`);
        console.log(`  ${C.dim}  https://sepolia.etherscan.io/tx/${data.onchain.hash}${C.reset}`);
      }

      gap();
      if (data.alerts?.length > 0) {
        for (const a of data.alerts) {
          if (a.success) ok(`${a.platform} alert sent`);
          else fail(`${a.platform} alert failed: ${a.error}`);
        }
      } else {
        dim('  No alerts configured');
      }
    } else {
      fail(`Server error: ${res.status} ${res.statusText}`);
    }
  } catch {
    fail(`Server unreachable at ${SERVER_URL}`);
    warn('Start server with: node server/server.mjs');
  }

  gap();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FETCH GUARD STATUS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function fetchGuardStatus() {
  try {
    const res = await fetch(`${SERVER_URL}/api/guard/status`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAIN LOOP
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

let checkCount = 0;
let successCount = 0;
let failCount = 0;
const startTime = Date.now();

async function loop() {
  checkCount++;

  const result = await runWorkflow();

  if (result) {
    successCount++;
    await postToServer(result);

    const guard = await fetchGuardStatus();
    if (guard) {
      sep();
      bold('  🛡️  SENTINALGUARD STATUS');
      sep();
      gap();

      const cbStatus = guard.globalPaused
        ? `${C.red}🔴 OPEN — ALL TRANSACTIONS BLOCKED`
        : `${C.green}🟢 CLOSED — SAFE`;
      const sevLabels = ['HEALTHY', 'WARNING', 'CRITICAL'];
      const sevColors = [C.green, C.yellow, C.red];
      const sevLabel = sevLabels[guard.severity] || String(guard.severity);
      const sevColor = sevColors[guard.severity] || C.white;

      console.log(`  ${C.bold}Circuit Breaker:${C.reset} ${cbStatus}${C.reset}`);
      console.log(`  ${C.bold}Severity:${C.reset}        ${sevColor}${sevLabel}${C.reset}`);
      console.log(`  ${C.bold}Registered:${C.reset}      ${guard.registered} protocols`);
      console.log(`  ${C.bold}Pause Events:${C.reset}    ${guard.pauseEvents} total`);
      gap();
    }
  } else {
    failCount++;
  }

  // ── Session Stats ──────────────────────────────
  const uptimeSec = Math.floor((Date.now() - startTime) / 1000);
  const uptimeStr = uptimeSec >= 60
    ? `${Math.floor(uptimeSec / 60)}m ${uptimeSec % 60}s`
    : `${uptimeSec}s`;

  sep();
  bold('  📈 SESSION STATS');
  sep();
  gap();
  console.log(`  ${C.bold}Uptime:${C.reset}    ${uptimeStr}`);
  console.log(`  ${C.bold}Checks:${C.reset}    ${checkCount} total`);
  console.log(`  ${C.green}${C.bold}Success:${C.reset}   ${successCount}`);
  if (failCount > 0) console.log(`  ${C.red}${C.bold}Failed:${C.reset}    ${failCount}`);
  gap();

  const nextAt = new Date(Date.now() + DELAY_MS).toLocaleTimeString();
  console.log(`  ${C.dim}⏳ Next check at ${nextAt} (in ${DELAY_MS / 1000}s)${C.reset}`);
  console.log(`  ${C.dim}   Ctrl+C to stop${C.reset}`);
  gap();

  setTimeout(loop, DELAY_MS);
}

// ── Start ─────────────────────────────────────────
banner();
loop();
