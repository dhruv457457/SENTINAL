import hre from "hardhat";
import { writeFileSync, existsSync, readFileSync } from "fs";
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
    writeFileSync("deployed-addresses-v3.json", JSON.stringify(data, null, 2));
}

function loadProgress(): any {
    try {
        return JSON.parse(readFileSync("deployed-addresses-v3.json", "utf8"));
    } catch {
        return {};
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONFIG
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const KEYSTONE_FORWARDER = "0x15fC6ae953E024d975e77382eEeC56A9101f9F88";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAIN
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function main() {
    console.log("\n🚀 SENTINAL V3 Contract Deployment\n");
    console.log("   New in V3:");
    console.log("   - SentinalGuard circuit breaker (open registry)");
    console.log("   - Velocity detection via getPreviousUtilizations()");
    console.log("   - Guard linked to Oracle for auto-pausing\n");

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
        console.log(`   ReserveOracleV2:     ${saved.ReserveOracleV2}`);
        console.log(`   EmergencyController: ${saved.EmergencyController}`);
        console.log(`   SentinalGuard:       ${saved.SentinalGuard}`);
        console.log("\n   Delete deployed-addresses-v3.json to redeploy fresh.");
        return;
    }

    let oracleAddress: string | null = saved.ReserveOracleV2 || null;
    let controllerAddress: string | null = saved.EmergencyController || null;
    let guardAddress: string | null = saved.SentinalGuard || null;

    if (oracleAddress) console.log(`\n📋 Resuming — Oracle:      ${oracleAddress}`);
    if (controllerAddress) console.log(`📋 Resuming — Controller:  ${controllerAddress}`);
    if (guardAddress) console.log(`📋 Resuming — Guard:       ${guardAddress}`);

    // ── Artifacts ───────────────────────────────────
    const ReserveOracleV2 = await hre.artifacts.readArtifact("ReserveOracleV2");
    const EmergencyController = await hre.artifacts.readArtifact("EmergencyController");
    const SentinalGuard = await hre.artifacts.readArtifact("SentinalGuard");

    // ━━━━ STEP 1: Deploy ReserveOracleV2 ━━━━━━━━━━━

    if (!oracleAddress) {
        console.log("\n━━━ STEP 1/7: Deploy ReserveOracleV2 ━━━");
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
            EmergencyController: null,
            SentinalGuard: null,
            forwarder: KEYSTONE_FORWARDER,
            reporter: account.address,
            linked: false,
            deployedAt: new Date().toISOString(),
        });
    } else {
        console.log(`\n━━━ STEP 1/7: ReserveOracleV2 ━━━ ✅ ${oracleAddress}`);
    }

    // ━━━━ STEP 2: Deploy EmergencyController ━━━━━━━━

    if (!controllerAddress) {
        console.log("\n━━━ STEP 2/7: Deploy EmergencyController ━━━");
        await checkBalance(publicClient, account.address);

        const hash = await walletClient.deployContract({
            abi: EmergencyController.abi,
            bytecode: EmergencyController.bytecode as `0x${string}`,
        });

        const receipt = await waitForTx(publicClient, hash, "EmergencyController");
        controllerAddress = receipt.contractAddress!;
        console.log(`   📍 ${controllerAddress}`);

        saveProgress({
            network: "sepolia",
            ReserveOracleV2: oracleAddress,
            EmergencyController: controllerAddress,
            SentinalGuard: null,
            forwarder: KEYSTONE_FORWARDER,
            reporter: account.address,
            linked: false,
            deployedAt: new Date().toISOString(),
        });
    } else {
        console.log(`\n━━━ STEP 2/7: EmergencyController ━━━ ✅ ${controllerAddress}`);
    }

    // ━━━━ STEP 3: Deploy SentinalGuard ━━━━━━━━━━━━━━

    if (!guardAddress) {
        console.log("\n━━━ STEP 3/7: Deploy SentinalGuard ━━━");
        await checkBalance(publicClient, account.address);

        const hash = await walletClient.deployContract({
            abi: SentinalGuard.abi,
            bytecode: SentinalGuard.bytecode as `0x${string}`,
            // no constructor args — open registry, owner is deployer
        });

        const receipt = await waitForTx(publicClient, hash, "SentinalGuard");
        guardAddress = receipt.contractAddress!;
        console.log(`   📍 ${guardAddress}`);

        saveProgress({
            network: "sepolia",
            ReserveOracleV2: oracleAddress,
            EmergencyController: controllerAddress,
            SentinalGuard: guardAddress,
            forwarder: KEYSTONE_FORWARDER,
            reporter: account.address,
            linked: false,
            deployedAt: new Date().toISOString(),
        });
    } else {
        console.log(`\n━━━ STEP 3/7: SentinalGuard ━━━ ✅ ${guardAddress}`);
    }

    // ━━━━ STEP 4: Link Oracle → EmergencyController ━━

    console.log("\n━━━ STEP 4/7: Link Oracle → EmergencyController ━━━");
    await checkBalance(publicClient, account.address);

    const hash4 = await walletClient.writeContract({
        address: oracleAddress as `0x${string}`,
        abi: ReserveOracleV2.abi,
        functionName: "setEmergencyController",
        args: [controllerAddress],
    });
    await waitForTx(publicClient, hash4, "Oracle → EmergencyController");

    // ━━━━ STEP 5: Link EmergencyController → Oracle ━━

    console.log("\n━━━ STEP 5/7: Link EmergencyController → Oracle ━━━");
    await checkBalance(publicClient, account.address);

    const hash5 = await walletClient.writeContract({
        address: controllerAddress as `0x${string}`,
        abi: EmergencyController.abi,
        functionName: "setOracle",
        args: [oracleAddress],
    });
    await waitForTx(publicClient, hash5, "Controller → Oracle");

    // ━━━━ STEP 6: Link SentinalGuard ↔ Oracle ━━━━━━━

    console.log("\n━━━ STEP 6/7: Link SentinalGuard ↔ Oracle ━━━");
    await checkBalance(publicClient, account.address);

    // Tell Guard which oracle is authorized to update it
    const hash6a = await walletClient.writeContract({
        address: guardAddress as `0x${string}`,
        abi: SentinalGuard.abi,
        functionName: "setOracle",
        args: [oracleAddress],
    });
    await waitForTx(publicClient, hash6a, "Guard.setOracle → Oracle");

    // Tell Oracle which guard to push status updates to
    const hash6b = await walletClient.writeContract({
        address: oracleAddress as `0x${string}`,
        abi: ReserveOracleV2.abi,
        functionName: "setGuard",
        args: [guardAddress],
    });
    await waitForTx(publicClient, hash6b, "Oracle.setGuard → Guard");

    // ━━━━ STEP 7: Verify Reporter Role ━━━━━━━━━━━━━━

    console.log("\n━━━ STEP 7/7: Verify Reporter Role ━━━");

    const currentReporter = await publicClient.readContract({
        address: oracleAddress as `0x${string}`,
        abi: ReserveOracleV2.abi,
        functionName: "reporter",
    });
    console.log(`   Reporter: ${currentReporter}`);

    if ((currentReporter as string).toLowerCase() !== account.address.toLowerCase()) {
        console.log("   Setting reporter to deployer...");
        const hash7 = await walletClient.writeContract({
            address: oracleAddress as `0x${string}`,
            abi: ReserveOracleV2.abi,
            functionName: "setReporter",
            args: [account.address],
        });
        await waitForTx(publicClient, hash7, "Set Reporter");
    } else {
        console.log("   ✅ Reporter already set correctly");
    }

    // ━━━━ DONE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    saveProgress({
        network: "sepolia",
        ReserveOracleV2: oracleAddress,
        EmergencyController: controllerAddress,
        SentinalGuard: guardAddress,
        forwarder: KEYSTONE_FORWARDER,
        reporter: account.address,
        linked: true,
        deployedAt: new Date().toISOString(),
    });

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("✅ V3 DEPLOYMENT COMPLETE!");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    console.log("📋 Addresses:");
    console.log(`   ReserveOracleV2:      ${oracleAddress}`);
    console.log(`   EmergencyController:  ${controllerAddress}`);
    console.log(`   SentinalGuard:        ${guardAddress}`);
    console.log(`   KeystoneForwarder:    ${KEYSTONE_FORWARDER}`);
    console.log(`   Reporter:             ${account.address}`);

    console.log("\n📋 Etherscan:");
    console.log(`   https://sepolia.etherscan.io/address/${oracleAddress}`);
    console.log(`   https://sepolia.etherscan.io/address/${controllerAddress}`);
    console.log(`   https://sepolia.etherscan.io/address/${guardAddress}`);

    console.log("\n📋 Verify contracts:");
    console.log(`   npx hardhat verify --network sepolia ${oracleAddress} "${KEYSTONE_FORWARDER}"`);
    console.log(`   npx hardhat verify --network sepolia ${controllerAddress}`);
    console.log(`   npx hardhat verify --network sepolia ${guardAddress}`);

    console.log("\n📋 Update config.staging.json:");
    console.log(`   "oracleAddress": "${oracleAddress}"`);

    console.log("\n📋 Update server .env:");
    console.log(`   ORACLE_ADDRESS=${oracleAddress}`);
    console.log(`   GUARD_ADDRESS=${guardAddress}`);

    console.log("\n🛡️  SentinalGuard Integration Example:");
    console.log("   Any protocol can now register:");
    console.log(`   ISentinalGuard guard = ISentinalGuard(${guardAddress});`);
    console.log('   string[] memory watched = new string[](1);');
    console.log('   watched[0] = "Aave V3 USDC (Ethereum)";');
    console.log('   guard.register(watched);');
    console.log('   // In deposit(): require(guard.isSafe(address(this)), "paused");');

    console.log("\n🎯 Next Steps:");
    console.log("   1. Update CRE config with new oracle address");
    console.log("   2. cre workflow simulate healthcheck --broadcast");
    console.log("   3. Start server: ORACLE_ADDRESS + GUARD_ADDRESS + PRIVATE_KEY");
    console.log("   4. node scripts/run-and-report.mjs");
    console.log("   5. Register test protocols on SentinalGuard via Etherscan\n");
}

main().catch((error) => {
    console.error("\n❌ Failed:", error.message || error);
    console.log("\n💡 Re-run this script — it resumes from where it stopped.");
    console.log("   Need ETH? https://faucets.chain.link\n");
    process.exitCode = 1;
});