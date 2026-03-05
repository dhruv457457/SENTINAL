import hre from "hardhat";
import { writeFileSync, readFileSync } from "fs";
import { createWalletClient, createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HELPERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function waitForTx(publicClient: any, hash: string, label: string) {
    console.log(`   ⏳ Waiting for tx: ${hash.slice(0, 10)}...`);
    try {
        const receipt = await publicClient.waitForTransactionReceipt({
            hash,
            timeout: 120_000,
            confirmations: 1,
        });
        if (receipt.status === "reverted") {
            throw new Error(`Transaction reverted! Hash: ${hash}`);
        }
        console.log(`   ✅ ${label} confirmed (gas: ${receipt.gasUsed.toString()})`);
        return receipt;
    } catch (err: any) {
        console.error(`   ❌ ${label} failed: ${err.message}`);
        throw err;
    }
}

async function checkBalance(publicClient: any, address: string) {
    const balance = await publicClient.getBalance({ address });
    const ethBalance = Number(balance) / 1e18;
    console.log(`   Balance: ${ethBalance.toFixed(4)} ETH`);
    if (ethBalance < 0.005) {
        console.log("   ⚠️  LOW BALANCE! Get more: https://faucets.chain.link");
    }
    if (ethBalance < 0.001) {
        throw new Error("Balance too low. Need at least 0.005 ETH.");
    }
    return ethBalance;
}

function saveProgress(data: any) {
    writeFileSync("deployed-addresses-v4.json", JSON.stringify(data, null, 2));
}

function loadProgress(): any {
    try {
        return JSON.parse(readFileSync("deployed-addresses-v4.json", "utf8"));
    } catch {
        return {};
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONFIG
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const KEYSTONE_FORWARDER = "0x15fC6ae953E024d975e77382eEeC56A9101f9F88";

// keccak256 of the fallback policy JSON — matches workflow log:
//   "📋 policyHash: 0xb776f6b6eaa75ef7..."
const INITIAL_POLICY_HASH = "0xb776f6b6eaa75ef73e094898a7aedb0312c7a8846d08041679e9de743dd9e5da" as `0x${string}`;
const INITIAL_POLICY_VERSION = "v1.0.0";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAIN
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function main() {
    console.log("\n🚀 SENTINAL V4 Contract Deployment\n");
    console.log("   Contracts: ReserveOracleV2 + SentinalGuard");
    console.log("   New in V4:");
    console.log("   - policyHash on every report (cryptographic compliance trail)");
    console.log("   - AttestationRegistry (auditable enforcement history)");
    console.log("   - Replay protection on onReport()");
    console.log("   - Timestamp freshness enforcement (1hr max age)");
    console.log("   - activatePolicy() for governance-ratified policy upgrades\n");

    // ── Setup ───────────────────────────────────────
    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) throw new Error("PRIVATE_KEY not set in .env");

    const rpcUrl = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
    const account = privateKeyToAccount(`0x${privateKey}`);

    const publicClient = createPublicClient({
        chain: sepolia,
        transport: http(rpcUrl),
    });

    const walletClient = createWalletClient({
        account,
        chain: sepolia,
        transport: http(rpcUrl),
    });

    console.log(`   Account:    ${account.address}`);
    console.log(`   Forwarder:  ${KEYSTONE_FORWARDER}`);
    await checkBalance(publicClient, account.address);

    // ── Resume from partial deploy ───────────────────
    const saved = loadProgress();

    if (saved.linked) {
        console.log("\n✅ Already fully deployed and linked!");
        console.log(`   ReserveOracleV2: ${saved.ReserveOracleV2}`);
        console.log(`   SentinalGuard:   ${saved.SentinalGuard}`);
        console.log("\n   Delete deployed-addresses-v4.json to redeploy fresh.");
        return;
    }

    let oracleAddress: string | null = saved.ReserveOracleV2 || null;
    let guardAddress: string | null = saved.SentinalGuard || null;

    if (oracleAddress) console.log(`\n📋 Resuming — Oracle: ${oracleAddress}`);
    if (guardAddress) console.log(`📋 Resuming — Guard:  ${guardAddress}`);

    // ── Artifacts ───────────────────────────────────
    const ReserveOracleV2 = await hre.artifacts.readArtifact("ReserveOracleV2");
    const SentinalGuard = await hre.artifacts.readArtifact("SentinalGuard");

    // ━━━━ STEP 1/5: Deploy ReserveOracleV2 ━━━━━━━━━

    if (!oracleAddress) {
        console.log("\n━━━ STEP 1/5: Deploy ReserveOracleV2 ━━━");
        await checkBalance(publicClient, account.address);

        const hash = await walletClient.deployContract({
            abi: ReserveOracleV2.abi,
            bytecode: ReserveOracleV2.bytecode as `0x${string}`,
            args: [KEYSTONE_FORWARDER],
        });

        const receipt = await waitForTx(publicClient, hash, "ReserveOracleV2");
        oracleAddress = receipt.contractAddress!;
        console.log(`   📍 ${oracleAddress}`);

        saveProgress({
            network: "sepolia",
            ReserveOracleV2: oracleAddress,
            SentinalGuard: null,
            forwarder: KEYSTONE_FORWARDER,
            reporter: account.address,
            linked: false,
            deployedAt: new Date().toISOString(),
        });
    } else {
        console.log(`\n━━━ STEP 1/5: ReserveOracleV2 ━━━ ✅ ${oracleAddress}`);
    }

    // ━━━━ STEP 2/5: Deploy SentinalGuard ━━━━━━━━━━━━

    if (!guardAddress) {
        console.log("\n━━━ STEP 2/5: Deploy SentinalGuard ━━━");
        await checkBalance(publicClient, account.address);

        const hash = await walletClient.deployContract({
            abi: SentinalGuard.abi,
            bytecode: SentinalGuard.bytecode as `0x${string}`,
        });

        const receipt = await waitForTx(publicClient, hash, "SentinalGuard");
        guardAddress = receipt.contractAddress!;
        console.log(`   📍 ${guardAddress}`);

        saveProgress({
            network: "sepolia",
            ReserveOracleV2: oracleAddress,
            SentinalGuard: guardAddress,
            forwarder: KEYSTONE_FORWARDER,
            reporter: account.address,
            linked: false,
            deployedAt: new Date().toISOString(),
        });
    } else {
        console.log(`\n━━━ STEP 2/5: SentinalGuard ━━━ ✅ ${guardAddress}`);
    }

    // ━━━━ STEP 3/5: Link SentinalGuard ↔ Oracle ━━━━━

    console.log("\n━━━ STEP 3/5: Link SentinalGuard ↔ Oracle ━━━");
    await checkBalance(publicClient, account.address);

    const hash3a = await walletClient.writeContract({
        address: guardAddress as `0x${string}`,
        abi: SentinalGuard.abi,
        functionName: "setOracle",
        args: [oracleAddress],
    });
    await waitForTx(publicClient, hash3a, "Guard.setOracle → Oracle");

    const hash3b = await walletClient.writeContract({
        address: oracleAddress as `0x${string}`,
        abi: ReserveOracleV2.abi,
        functionName: "setGuard",
        args: [guardAddress],
    });
    await waitForTx(publicClient, hash3b, "Oracle.setGuard → Guard");

    // ━━━━ STEP 4/5: Verify Reporter Role ━━━━━━━━━━━━

    console.log("\n━━━ STEP 4/5: Verify Reporter Role ━━━");

    const currentReporter = await publicClient.readContract({
        address: oracleAddress as `0x${string}`,
        abi: ReserveOracleV2.abi,
        functionName: "reporter",
    });
    console.log(`   Reporter: ${currentReporter}`);

    if ((currentReporter as string).toLowerCase() !== account.address.toLowerCase()) {
        console.log("   Setting reporter to deployer...");
        const hash4 = await walletClient.writeContract({
            address: oracleAddress as `0x${string}`,
            abi: ReserveOracleV2.abi,
            functionName: "setReporter",
            args: [account.address],
        });
        await waitForTx(publicClient, hash4, "Set Reporter");
    } else {
        console.log("   ✅ Reporter already set correctly");
    }

    // ━━━━ STEP 5/5: Activate Initial Policy Version ━━

    console.log("\n━━━ STEP 5/5: Activate Initial Policy Version ━━━");
    console.log(`   Hash:    ${INITIAL_POLICY_HASH.slice(0, 18)}...`);
    console.log(`   Version: ${INITIAL_POLICY_VERSION}`);
    await checkBalance(publicClient, account.address);

    const hash5 = await walletClient.writeContract({
        address: oracleAddress as `0x${string}`,
        abi: ReserveOracleV2.abi,
        functionName: "activatePolicy",
        args: [INITIAL_POLICY_HASH, INITIAL_POLICY_VERSION],
    });
    await waitForTx(publicClient, hash5, "activatePolicy");
    console.log(`   ✅ Policy activated on-chain`);

    // ━━━━ DONE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    saveProgress({
        network: "sepolia",
        ReserveOracleV2: oracleAddress,
        SentinalGuard: guardAddress,
        forwarder: KEYSTONE_FORWARDER,
        reporter: account.address,
        policyHash: INITIAL_POLICY_HASH,
        policyVersion: INITIAL_POLICY_VERSION,
        linked: true,
        deployedAt: new Date().toISOString(),
    });

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("✅ V4 DEPLOYMENT COMPLETE!");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    console.log("📋 Addresses:");
    console.log(`   ReserveOracleV2: ${oracleAddress}`);
    console.log(`   SentinalGuard:   ${guardAddress}`);
    console.log(`   Forwarder:       ${KEYSTONE_FORWARDER}`);
    console.log(`   Reporter:        ${account.address}`);
    console.log(`   Policy:          ${INITIAL_POLICY_HASH.slice(0, 18)}... (${INITIAL_POLICY_VERSION})`);

    console.log("\n📋 Etherscan:");
    console.log(`   https://sepolia.etherscan.io/address/${oracleAddress}`);
    console.log(`   https://sepolia.etherscan.io/address/${guardAddress}`);

    console.log("\n📋 Verify contracts:");
    console.log(`   npx hardhat verify --network sepolia ${oracleAddress} "${KEYSTONE_FORWARDER}"`);
    console.log(`   npx hardhat verify --network sepolia ${guardAddress}`);

    console.log("\n📋 Update CRE config.staging.json:");
    console.log(`   "oracleAddress": "${oracleAddress}"`);

    console.log("\n📋 Update server .env:");
    console.log(`   ORACLE_ADDRESS=${oracleAddress}`);
    console.log(`   GUARD_ADDRESS=${guardAddress}`);

    console.log("\n🔐 AttestationRegistry — demo on Etherscan:");
    console.log(`   getAttestation(checkNumber)         → policyHash + severity + timestamp`);
    console.log(`   verifyPolicyCompliance(checkNumber) → compliant: true/false`);
    console.log(`   getRecentAttestations(10)           → last 10 enforcement records`);

    console.log("\n🛡️  SentinalGuard Integration:");
    console.log(`   ISentinalGuard guard = ISentinalGuard(${guardAddress});`);
    console.log('   string[] memory watched = new string[](1);');
    console.log('   watched[0] = "Aave V3 USDC (Ethereum)";');
    console.log('   guard.register(watched);');
    console.log('   // In deposit(): require(guard.isSafe(address(this)), "paused");');

    console.log("\n🎯 Next Steps:");
    console.log("   1. Update CRE config with new oracle address");
    console.log("   2. cre workflow simulate healthcheck --broadcast");
    console.log("   3. Start server: ORACLE_ADDRESS + GUARD_ADDRESS + PRIVATE_KEY");
    console.log("   4. node scripts/run-and-report.mjs\n");
}

main().catch((error) => {
    console.error("\n❌ Failed:", error.message || error);
    console.log("\n💡 Re-run this script — it resumes from where it stopped.");
    console.log("   Need ETH? https://faucets.chain.link\n");
    process.exitCode = 1;
});