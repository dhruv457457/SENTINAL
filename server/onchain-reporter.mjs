// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SENTINAL Onchain Reporter
// Submits per-protocol data to ReserveOracleV2
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { createWalletClient, createPublicClient, http, parseAbi } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const ORACLE_ABI = parseAbi([
  'function submitProtocolData(uint256 checkNumber, string[] names, string[] types, string[] chains, uint256[] claimed, uint256[] actual, uint256[] solvencyRatios, uint256[] utilizations) external',
  'function totalChecks() view returns (uint256)',
  'function getLatestReport() view returns ((uint256,uint256,uint256,uint256,uint256,uint256,uint8,bool))',
  'function getAllLatestProtocols() view returns ((string,string,string,uint256,uint256,uint256,uint256,uint256)[])',
  'function getDashboardData() view returns ((uint256,uint256,uint256,uint256,uint256,uint256,uint8,bool), uint256, uint256, uint256, uint256, uint256, uint256, (string,string,string,uint256,uint256,uint256,uint256,uint256)[])',
  'function getStatistics() view returns (uint256, uint256, uint256, uint256, uint256, uint256, uint256)',
]);

export function createOnchainReporter(oracleAddress, privateKey, rpcUrl) {
  const account = privateKeyToAccount(privateKey);

  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(rpcUrl || 'https://ethereum-sepolia-rpc.publicnode.com'),
  });

  const walletClient = createWalletClient({
    account,
    chain: sepolia,
    transport: http(rpcUrl || 'https://ethereum-sepolia-rpc.publicnode.com'),
  });

  return {
    /**
     * Submit per-protocol data onchain
     * @param {object} result - CRE workflow result JSON
     */
    async submitProtocolData(result) {
      const protocols = result.protocols;
      if (!protocols || protocols.length === 0) {
        console.log('   ⚠️  No protocol data to submit');
        return null;
      }

      const names = protocols.map(p => p.name);
      const types = protocols.map(p => p.type);
      const chains = protocols.map(p => p.chain);
      const claimed = protocols.map(p => BigInt(p.details.match(/Deposits=\$(\d+)/)?.[1] || p.details.match(/stETH=(\d+)/)?.[1] || '0'));
      const actual = protocols.map(p => {
        // Parse actual from details string
        const liqMatch = p.details.match(/Liq=\$(\d+)/);
        const borrowMatch = p.details.match(/Borrows=\$(\d+)/);
        const pooledMatch = p.details.match(/Pooled=(\d+)/);
        if (liqMatch && borrowMatch) return BigInt(liqMatch[1]) + BigInt(borrowMatch[1]);
        if (pooledMatch) return BigInt(pooledMatch[1]);
        return 0n;
      });
      const solvencyRatios = protocols.map(p => BigInt(Math.floor(parseFloat(p.solvency) * 100)));
      const utilizations = protocols.map(p => {
        const utilMatch = p.details.match(/Util=(\d+\.?\d*)%/);
        return utilMatch ? BigInt(Math.floor(parseFloat(utilMatch[1]) * 100)) : 0n;
      });

      try {
        const hash = await walletClient.writeContract({
          address: oracleAddress,
          abi: ORACLE_ABI,
          functionName: 'submitProtocolData',
          args: [
            BigInt(result.checkNumber),
            names,
            types,
            chains,
            claimed,
            actual,
            solvencyRatios,
            utilizations,
          ],
        });

        console.log(`   📝 Protocol data tx: ${hash}`);

        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        console.log(`   ✅ Confirmed in block ${receipt.blockNumber}`);

        return { hash, blockNumber: Number(receipt.blockNumber) };
      } catch (err) {
        console.error(`   ❌ Onchain submit failed: ${err.message}`);
        return null;
      }
    },

    /**
     * Read dashboard data from contract
     */
    async getDashboardData() {
      try {
        const data = await publicClient.readContract({
          address: oracleAddress,
          abi: ORACLE_ABI,
          functionName: 'getDashboardData',
        });
        return data;
      } catch (err) {
        console.error(`❌ Read failed: ${err.message}`);
        return null;
      }
    },

    /**
     * Read statistics from contract
     */
    async getStatistics() {
      try {
        const data = await publicClient.readContract({
          address: oracleAddress,
          abi: ORACLE_ABI,
          functionName: 'getStatistics',
        });
        return {
          totalChecks: Number(data[0]),
          totalWarnings: Number(data[1]),
          totalCritical: Number(data[2]),
          totalAnomalies: Number(data[3]),
          currentRisk: Number(data[4]),
          peakRisk: Number(data[5]),
          peakRiskCheck: Number(data[6]),
        };
      } catch (err) {
        console.error(`❌ Stats read failed: ${err.message}`);
        return null;
      }
    },
  };
}
