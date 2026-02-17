import { createWalletClient, createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

async function main() {
    const account = privateKeyToAccount(`0x${process.env.PRIVATE_KEY}`);
    const walletClient = createWalletClient({ account, chain: sepolia, transport: http(process.env.SEPOLIA_RPC_URL) });
    const publicClient = createPublicClient({ chain: sepolia, transport: http(process.env.SEPOLIA_RPC_URL) });

    const hash = await walletClient.writeContract({
        address: "0xdc4348ab53a34407b92bb567b37ed4d9d5360096",
        abi: [{ inputs: [{ name: "_forwarder", type: "address" }], name: "setForwarder", outputs: [], stateMutability: "nonpayable", type: "function" }],
        functionName: "setForwarder",
        args: ["0x15fC6ae953E024d975e77382eEeC56A9101f9F88"],
    });

    console.log("Tx:", hash);
    await publicClient.waitForTransactionReceipt({ hash });
    console.log("✅ Forwarder set to KeystoneForwarder!");
}

main().catch(console.error);