#!/usr/bin/env node
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SENTINAL Runner — Continuous Loop Mode
// Usage: node scripts/run-and-report.mjs --broadcast
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { execSync } from 'child_process';

const SERVER_URL = process.env.SENTINAL_SERVER || 'http://localhost:3001';
const broadcast = process.argv.includes('--broadcast');
// ✅ CONFIG: Time to wait between checks (60 seconds)
const DELAY_MS = 60 * 1000;

// Point to the workflow directory
const WORKFLOW_DIR = './cre-workflow/healthcheck-monitor';

const cmd = broadcast
  ? 'cre workflow simulate healthcheck --broadcast'
  : 'cre workflow simulate healthcheck';

async function runCheck() {
  // ── 1. Run CRE Workflow ────────────────────────
  console.log(`\n🚀 Starting check at ${new Date().toLocaleTimeString()}...`);

  let output;
  try {
    output = execSync(cmd, {
      encoding: 'utf8',
      timeout: 120000,
      cwd: WORKFLOW_DIR
    });
  } catch (err) {
    // execSync throws on exit code != 0, but we want to capture stdout
    output = err.stdout || '';
    if (!output.includes('Workflow Simulation Result')) {
      console.error('❌ Workflow execution failed completely.');
      console.error(err.stderr || err.message);
      return; // Skip this loop iteration
    }
  }

  // ── 2. Parse JSON Result ───────────────────────
  const jsonMatch = output.match(/Workflow Simulation Result:\s*\n\s*(\{[\s\S]*?\n\})/);
  if (!jsonMatch) {
    console.error('❌ Could not parse JSON output from workflow.');
    return;
  }

  const result = JSON.parse(jsonMatch[1]);
  console.log(`📊 Check #${result.checkNumber} | ${result.severity} | Risk: ${result.riskScore}/100`);

  // ── 3. POST to Backend ─────────────────────────
  try {
    const res = await fetch(`${SERVER_URL}/api/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    });

    if (res.ok) {
      const data = await res.json();
      console.log(`✅ Server synced.`);

      if (data.alerts?.length > 0) {
        for (const a of data.alerts) {
          console.log(`   ${a.success ? '🔔' : '❌'} Alert (${a.platform}): ${a.success ? 'Sent' : a.error}`);
        }
      }
    } else {
      console.error(`❌ Server returned error: ${res.status} ${res.statusText}`);
    }
  } catch (err) {
    console.error(`❌ Server unreachable at ${SERVER_URL}`);
  }
}

async function loop() {
  await runCheck();
  console.log(`\n⏳ Waiting ${DELAY_MS / 1000}s for next check...`);

  // Schedule next run
  setTimeout(loop, DELAY_MS);
}

// Start the loop
console.log(`\n🔄 Starting SENTINAL Loop (Interval: ${DELAY_MS / 1000}s)`);
if (broadcast) console.log("📡 BROADCAST MODE ENABLED (Real TXs)");
loop();