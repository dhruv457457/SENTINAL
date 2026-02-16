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
    writeFileSync("deployed-addresses.json", JSON.stringify(data, null, 2));
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAIN
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function main() {
    console.log("\n🚀 SENTINAL Contract Deployment\n");

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

    console.log(`   Account:  ${account.address}`);
    await checkBalance(publicClient, account.address);

    // ── Resume from partial deploy if exists ────────
    let oracleAddress: string | null = null;
    let controllerAddress: string | null = null;
    let linked = false;

    if (existsSync("deployed-addresses.json")) {
        try {
            const saved = JSON.parse(readFileSync("deployed-addresses.json", "utf8"));
            if (saved.ReserveOracle && !saved.linked) {
                console.log("\n📋 Resuming partial deployment...");
                oracleAddress = saved.ReserveOracle;
                controllerAddress = saved.EmergencyController || null;
                console.log(`   Oracle:     ${oracleAddress || "pending"}`);
                console.log(`   Controller: ${controllerAddress || "pending"}`);
            } else if (saved.linked) {
                linked = true;
            }
        } catch { /* ignore corrupt file */ }
    }

    if (linked) {
        const saved = JSON.parse(readFileSync("deployed-addresses.json", "utf8"));
        console.log("\n✅ Already fully deployed and linked!");
        console.log(`   Oracle:     ${saved.ReserveOracle}`);
        console.log(`   Controller: ${saved.EmergencyController}`);
        console.log("\n   Delete deployed-addresses.json to redeploy fresh.");
        return;
    }

    // ── Artifacts ───────────────────────────────────
    const ReserveOracle = await hre.artifacts.readArtifact("ReserveOracleV2");
    const EmergencyController = await hre.artifacts.readArtifact("EmergencyController");

    // ━━━━ STEP 1: Deploy ReserveOracle ━━━━━━━━━━━━━

    if (!oracleAddress) {
        console.log("\n━━━ STEP 1/4: Deploy ReserveOracle ━━━");

        const oracleHash = await walletClient.deployContract({
            abi: ReserveOracle.abi,
            bytecode: ReserveOracle.bytecode as `0x${string}`,
            args: [account.address],
        });

        const receipt = await waitForTx(publicClient, oracleHash, "ReserveOracle");
        oracleAddress = receipt.contractAddress!;
        console.log(`   📍 ${oracleAddress}`);

        saveProgress({
            network: "sepolia",
            ReserveOracle: oracleAddress,
            EmergencyController: null,
            forwarder: account.address,
            linked: false,
            deployedAt: new Date().toISOString(),
        });
    } else {
        console.log(`\n━━━ STEP 1/4: ReserveOracle ━━━ ✅ ${oracleAddress}`);
    }

    // ━━━━ STEP 2: Deploy EmergencyController ━━━━━━━

    if (!controllerAddress) {
        console.log("\n━━━ STEP 2/4: Deploy EmergencyController ━━━");
        await checkBalance(publicClient, account.address);

        const controllerHash = await walletClient.deployContract({
            abi: EmergencyController.abi,
            bytecode: EmergencyController.bytecode as `0x${string}`,
        });

        const receipt = await waitForTx(publicClient, controllerHash, "EmergencyController");
        controllerAddress = receipt.contractAddress!;
        console.log(`   📍 ${controllerAddress}`);

        saveProgress({
            network: "sepolia",
            ReserveOracle: oracleAddress,
            EmergencyController: controllerAddress,
            forwarder: account.address,
            linked: false,
            deployedAt: new Date().toISOString(),
        });
    } else {
        console.log(`\n━━━ STEP 2/4: EmergencyController ━━━ ✅ ${controllerAddress}`);
    }

    // ━━━━ STEP 3: Link Oracle → Controller ━━━━━━━━━

    console.log("\n━━━ STEP 3/4: Link Oracle → Controller ━━━");
    await checkBalance(publicClient, account.address);

    const hash1 = await walletClient.writeContract({
        address: oracleAddress as `0x${string}`,
        abi: ReserveOracle.abi,
        functionName: "setEmergencyController",
        args: [controllerAddress],
    });
    await waitForTx(publicClient, hash1, "Oracle → Controller");

    // ━━━━ STEP 4: Link Controller → Oracle ━━━━━━━━━

    console.log("\n━━━ STEP 4/4: Link Controller → Oracle ━━━");
    await checkBalance(publicClient, account.address);

    const hash2 = await walletClient.writeContract({
        address: controllerAddress as `0x${string}`,
        abi: EmergencyController.abi,
        functionName: "setOracle",
        args: [oracleAddress],
    });
    await waitForTx(publicClient, hash2, "Controller → Oracle");

    // ━━━━ DONE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    saveProgress({
        network: "sepolia",
        ReserveOracle: oracleAddress,
        EmergencyController: controllerAddress,
        forwarder: account.address,
        linked: true,
        deployedAt: new Date().toISOString(),
    });

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("✅ DEPLOYMENT COMPLETE!");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    console.log("📋 Addresses:");
    console.log(`   ReserveOracle:        ${oracleAddress}`);
    console.log(`   EmergencyController:  ${controllerAddress}`);

    console.log("\n📋 Etherscan:");
    console.log(`   https://sepolia.etherscan.io/address/${oracleAddress}`);
    console.log(`   https://sepolia.etherscan.io/address/${controllerAddress}`);

    console.log("\n📋 Verify:");
    console.log(`   npx hardhat verify --network sepolia ${oracleAddress} ${account.address}`);
    console.log(`   npx hardhat verify --network sepolia ${controllerAddress}`);

    console.log("\n📋 Update config.staging.json:");
    console.log(`   "oracleAddress": "${oracleAddress}"`);

    console.log("\n🎯 Next:");
    console.log("   cre workflow simulate healthcheck");
    console.log("   cre workflow simulate healthcheck --broadcast\n");
}

main().catch((error) => {
    console.error("\n❌ Failed:", error.message || error);
    console.log("\n💡 Re-run this script — it resumes from where it stopped.");
    console.log("   Need ETH? https://faucets.chain.link\n");
    process.exitCode = 1;
});