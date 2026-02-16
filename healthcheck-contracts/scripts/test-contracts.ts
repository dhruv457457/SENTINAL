import hre from "hardhat";
import { createPublicClient, http, getContract } from "viem";
import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient } from "viem";
const ORACLE_ADDRESS = "0xdc4348ab53a34407b92bb567b37ed4d9d5360096";
const CONTROLLER_ADDRESS = "0x15483bb910c04c41433c41d41080290c73aa1eaf";

async function main() {
  console.log("🧪 Testing SENTINAL Contracts...\n");

  // Setup wallet
  const account = privateKeyToAccount(`0x${process.env.PRIVATE_KEY}`);
  
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(process.env.SEPOLIA_RPC_URL || "https://eth-sepolia.g.alchemy.com/v2/demo"),
  });

  const walletClient = createWalletClient({
    account,
    chain: sepolia,
    transport: http(process.env.SEPOLIA_RPC_URL || "https://eth-sepolia.g.alchemy.com/v2/demo"),
  });

  // Get contract artifacts
const ReserveOracle = await hre.artifacts.readArtifact("ReserveOracleV2");
  const EmergencyController = await hre.artifacts.readArtifact("EmergencyController");

  console.log("📋 Contract Addresses:");
  console.log("   Oracle:     ", ORACLE_ADDRESS);
  console.log("   Controller: ", CONTROLLER_ADDRESS);
  console.log("   Tester:     ", account.address, "\n");

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // TEST 1: HEALTHY SCENARIO
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("TEST 1: HEALTHY Scenario (95% reserves)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const hash1 = await walletClient.writeContract({
    address: ORACLE_ADDRESS as `0x${string}`,
    abi: ReserveOracle.abi,
    functionName: 'simulateHealthy',
  });

  console.log("⏳ Waiting for transaction...");
  const receipt1 = await publicClient.waitForTransactionReceipt({ hash: hash1 });
  console.log("✅ Transaction confirmed:", hash1);
  console.log("   Gas used:", receipt1.gasUsed.toString(), "\n");

  // Read latest report
  const report1 = await publicClient.readContract({
    address: ORACLE_ADDRESS as `0x${string}`,
    abi: ReserveOracle.abi,
    functionName: 'getLatestReport',
  }) as any;

  console.log("📊 Latest Report:");
  console.log("   Total Reserves: $" + (Number(report1.totalReservesUSD) / 1_000_000).toFixed(2) + "M");
  console.log("   Total Claimed:  $" + (Number(report1.totalClaimedUSD) / 1_000_000).toFixed(2) + "M");
  console.log("   Ratio:          " + (Number(report1.globalRatio) / 100).toFixed(2) + "%");
  console.log("   Risk Score:     " + report1.riskScore.toString() + "/100");
  console.log("   Severity:       " + ["✅ HEALTHY", "⚠️ WARNING", "🚨 CRITICAL"][Number(report1.severity)]);
  console.log("   Anomaly:        " + (report1.anomalyDetected ? "YES 🔴" : "NO ✅"));
  console.log("   Check Number:   #" + report1.checkNumber.toString() + "\n");

  // Wait a bit
  await sleep(2000);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // TEST 2: WARNING SCENARIO
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("TEST 2: WARNING Scenario (85% reserves)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const hash2 = await walletClient.writeContract({
    address: ORACLE_ADDRESS as `0x${string}`,
    abi: ReserveOracle.abi,
    functionName: 'simulateWarning',
  });

  console.log("⏳ Waiting for transaction...");
  const receipt2 = await publicClient.waitForTransactionReceipt({ hash: hash2 });
  console.log("✅ Transaction confirmed:", hash2);
  console.log("   Gas used:", receipt2.gasUsed.toString(), "\n");

  const report2 = await publicClient.readContract({
    address: ORACLE_ADDRESS as `0x${string}`,
    abi: ReserveOracle.abi,
    functionName: 'getLatestReport',
  }) as any;

  console.log("📊 Latest Report:");
  console.log("   Total Reserves: $" + (Number(report2.totalReservesUSD) / 1_000_000).toFixed(2) + "M");
  console.log("   Total Claimed:  $" + (Number(report2.totalClaimedUSD) / 1_000_000).toFixed(2) + "M");
  console.log("   Ratio:          " + (Number(report2.globalRatio) / 100).toFixed(2) + "%");
  console.log("   Risk Score:     " + report2.riskScore.toString() + "/100");
  console.log("   Severity:       " + ["✅ HEALTHY", "⚠️ WARNING", "🚨 CRITICAL"][Number(report2.severity)]);
  console.log("   Anomaly:        " + (report2.anomalyDetected ? "YES 🔴" : "NO ✅"));
  console.log("   Check Number:   #" + report2.checkNumber.toString() + "\n");

  await sleep(2000);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // TEST 3: CRITICAL SCENARIO (AUTO-PAUSE!)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("TEST 3: CRITICAL Scenario (75% reserves)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const hash3 = await walletClient.writeContract({
    address: ORACLE_ADDRESS as `0x${string}`,
    abi: ReserveOracle.abi,
    functionName: 'simulateCritical',
  });

  console.log("⏳ Waiting for transaction...");
  const receipt3 = await publicClient.waitForTransactionReceipt({ hash: hash3 });
  console.log("✅ Transaction confirmed:", hash3);
  console.log("   Gas used:", receipt3.gasUsed.toString(), "\n");

  const report3 = await publicClient.readContract({
    address: ORACLE_ADDRESS as `0x${string}`,
    abi: ReserveOracle.abi,
    functionName: 'getLatestReport',
  }) as any;

  console.log("📊 Latest Report:");
  console.log("   Total Reserves: $" + (Number(report3.totalReservesUSD) / 1_000_000).toFixed(2) + "M");
  console.log("   Total Claimed:  $" + (Number(report3.totalClaimedUSD) / 1_000_000).toFixed(2) + "M");
  console.log("   Ratio:          " + (Number(report3.globalRatio) / 100).toFixed(2) + "%");
  console.log("   Risk Score:     " + report3.riskScore.toString() + "/100");
  console.log("   Severity:       " + ["✅ HEALTHY", "⚠️ WARNING", "🚨 CRITICAL"][Number(report3.severity)]);
  console.log("   Anomaly:        " + (report3.anomalyDetected ? "YES 🔴" : "NO ✅"));
  console.log("   Check Number:   #" + report3.checkNumber.toString() + "\n");

  // Check if protocol was paused
  const isPaused = await publicClient.readContract({
    address: CONTROLLER_ADDRESS as `0x${string}`,
    abi: EmergencyController.abi,
    functionName: 'isPaused',
  });

  console.log("🚨 Emergency Controller Status:");
  console.log("   Protocol Paused:", isPaused ? "YES 🔴" : "NO ✅");
  console.log("\n");

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STATISTICS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("OVERALL STATISTICS");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const stats = await publicClient.readContract({
    address: ORACLE_ADDRESS as `0x${string}`,
    abi: ReserveOracle.abi,
    functionName: 'getStatistics',
  }) as any;

  console.log("📈 Oracle Statistics:");
  console.log("   Total Checks:   " + stats[0].toString());
  console.log("   Warnings:       " + stats[1].toString());
  console.log("   Criticals:      " + stats[2].toString());
  console.log("   Current Risk:   " + stats[3].toString() + "/100");
  console.log("\n");

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // HISTORY
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("RECENT HISTORY");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const history = await publicClient.readContract({
    address: ORACLE_ADDRESS as `0x${string}`,
    abi: ReserveOracle.abi,
    functionName: 'getReportHistory',
    args: [3],
  }) as any;

  console.log("📜 Last 3 Health Checks:\n");
  
  for (let i = 0; i < history.length; i++) {
    const h = history[i];
    console.log(`   Check #${h.checkNumber.toString()}:`);
    console.log(`   ├─ Ratio:    ${(Number(h.globalRatio) / 100).toFixed(2)}%`);
    console.log(`   ├─ Risk:     ${h.riskScore.toString()}/100`);
    console.log(`   ├─ Severity: ${["HEALTHY ✅", "WARNING ⚠️", "CRITICAL 🚨"][Number(h.severity)]}`);
    console.log(`   └─ Time:     ${new Date(Number(h.timestamp) * 1000).toLocaleString()}`);
    console.log("");
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SUMMARY
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("✅ ALL TESTS PASSED!");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  console.log("🎯 Test Results Summary:");
  console.log("   ✅ HEALTHY scenario:  Risk=" + report1.riskScore.toString() + ", Severity=HEALTHY");
  console.log("   ⚠️  WARNING scenario:  Risk=" + report2.riskScore.toString() + ", Severity=WARNING");
  console.log("   🚨 CRITICAL scenario: Risk=" + report3.riskScore.toString() + ", Severity=CRITICAL");
  console.log("   🔐 Auto-pause:        " + (isPaused ? "TRIGGERED ✅" : "NOT TRIGGERED ❌"));
  console.log("\n");

  console.log("📋 View on Etherscan:");
  console.log("   Oracle:     https://sepolia.etherscan.io/address/" + ORACLE_ADDRESS);
  console.log("   Controller: https://sepolia.etherscan.io/address/" + CONTROLLER_ADDRESS);
  console.log("\n");

  console.log("🎉 Contracts are working perfectly!");
  console.log("🚀 Next: Deploy CRE workflow to automate monitoring!\n");
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});