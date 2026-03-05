const fs = require("fs");
const path = require("path");

// ─── CONFIG ────────────────────────────────────────────────────────────────
const ETHERSCAN_API_KEY = "11T6E53NN46BTY68AJYBN8GEHHTNVWRPRF";
const API_URL = "https://api.etherscan.io/v2/api?chainid=11155111";
const CONTRACTS = [
    {
        name: "ReserveOracleV2",
        address: "0x985eb2859e7502f38d3944a4a6d10aa5d7158b24",  // ← new
        contractPath: "project/contracts/ReserveOracleV2.sol",
    },
    {
        name: "SentinalGuard",
        address: "0xfc3082f4954f36ce7794e6c49769b9bf819fc80a",  // ← new
        contractPath: "project/contracts/SentinalGuard.sol",
    },
];
// ───────────────────────────────────────────────────────────────────────────

function findBuildInfo() {
    const buildInfoDir = path.join("artifacts", "build-info");
    if (!fs.existsSync(buildInfoDir)) {
        throw new Error("artifacts/build-info not found. Run `npx hardhat compile` first.");
    }

    const files = fs
        .readdirSync(buildInfoDir)
        .filter((f) => f.endsWith(".json") && !f.endsWith(".output.json"))
        .map((f) => path.join(buildInfoDir, f))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

    if (!files.length) throw new Error("No build-info JSON found.");
    return files[0];
}

async function submitVerification(contract, standardJsonInput, compilerVersion) {
    const contractName = `${contract.contractPath}:${contract.name}`;

    const params = new URLSearchParams({
        apikey: ETHERSCAN_API_KEY,
        module: "contract",
        action: "verifysourcecode",
        contractaddress: contract.address,
        sourceCode: JSON.stringify(standardJsonInput),
        codeformat: "solidity-standard-json-input",
        contractname: contractName,
        compilerversion: `v${compilerVersion}`,
        constructorArguements: "",
    });

    const res = await fetch(API_URL, {
        method: "POST",
        body: params,
    });

    const json = await res.json();
    if (json.status !== "1") throw new Error(`Submission failed: ${json.result}`);
    return json.result; // GUID
}

async function pollStatus(guid, contractName) {
    console.log(`  ⏳ Polling verification status for ${contractName}...`);

    for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 5000));

const url = `${API_URL}&module=contract&action=checkverifystatus&guid=${guid}&apikey=${ETHERSCAN_API_KEY}`;        const res = await fetch(url);
        const json = await res.json();

        console.log(`  [${i + 1}] ${json.result}`);

        if (json.result === "Pass - Verified") return true;
        if (json.result && json.result.startsWith("Fail")) {
            throw new Error(`Verification failed: ${json.result}`);
        }
    }

    throw new Error("Timed out waiting for verification");
}

async function main() {
    if (ETHERSCAN_API_KEY === "YOUR_API_KEY_HERE") {
        console.error("❌ Set ETHERSCAN_API_KEY env variable:");
        console.error("   ETHERSCAN_API_KEY=your_key node verify-contracts.js");
        process.exit(1);
    }

    const buildInfoPath = findBuildInfo();
    console.log(`📦 Using build-info: ${buildInfoPath}`);

    const buildInfo = JSON.parse(fs.readFileSync(buildInfoPath, "utf8"));
    const standardJsonInput = buildInfo.input;
    const compilerVersion = buildInfo.solcLongVersion;

    console.log(`🔧 Compiler: v${compilerVersion}`);
    console.log(`🔧 viaIR: ${standardJsonInput.settings?.viaIR ?? false}`);
    console.log(`🔧 Optimizer: ${standardJsonInput.settings?.optimizer?.enabled}, runs: ${standardJsonInput.settings?.optimizer?.runs}\n`);

    for (const contract of CONTRACTS) {
        console.log(`\n🚀 Verifying ${contract.name} at ${contract.address}`);
        try {
            const guid = await submitVerification(contract, standardJsonInput, compilerVersion);
            console.log(`  ✅ Submitted. GUID: ${guid}`);
            await pollStatus(guid, contract.name);
            console.log(`  ✅ ${contract.name} VERIFIED!`);
        } catch (err) {
            console.error(`  ❌ ${contract.name}: ${err.message}`);
        }
    }
}

main();