// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SENTINAL Onchain Reporter v2
// Submits per-protocol data + velocity to ReserveOracleV2
// Also reads SentinalGuard status
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { createWalletClient, createPublicClient, http, parseAbi } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const ORACLE_ABI = parseAbi([
  // Updated: now includes velocityBps + velocityNegative arrays
  'function submitProtocolData(uint256 checkNumber, string[] names, string[] types, string[] chains, uint256[] claimed, uint256[] actual, uint256[] solvencyRatios, uint256[] utilizations, uint256[] velocityBps, bool[] velocityNegative) external',
  'function totalChecks() view returns (uint256)',
  'function getLatestReport() view returns ((uint256,uint256,uint256,uint256,uint256,uint256,uint8,bool))',
  'function getAllLatestProtocols() view returns ((string,string,string,uint256,uint256,uint256,uint256,uint256,bool,uint256)[])',
  'function getDashboardData() view returns ((uint256,uint256,uint256,uint256,uint256,uint256,uint8,bool), uint256, uint256, uint256, uint256, uint256, uint256, (string,string,string,uint256,uint256,uint256,uint256,uint256,bool,uint256)[])',
  'function getStatistics() view returns (uint256, uint256, uint256, uint256, uint256, uint256, uint256)',
  'function getVelocityStats() view returns (uint256, uint256, string, (string,string,string,uint256,uint256,uint256,uint256,uint256,bool,uint256)[])',
]);

const GUARD_ABI = parseAbi([
  'function getGuardStatus() view returns (bool globalPaused, uint8 severity, uint256 registered, uint256 pauseEvents, uint256 lastUpdate)',
  'function isProtocolSafe(string name) view returns (bool)',
  'function totalRegistered() view returns (uint256)',
  'function getProtocolStatus(string name) view returns (bool paused, bool warning, uint256 solvency, uint256 lastCheckNumber, uint256 lastUpdated)',
]);

export function createOnchainReporter(oracleAddress, privateKey, rpcUrl, guardAddress = null) {
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
     * Submit per-protocol data + velocity onchain
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

      // Parse claimed from details string
      const claimed = protocols.map(p => {
        const depositsMatch = p.details.match(/Deposits=\$(\d+)/);
        const stEthMatch = p.details.match(/stETH=(\d+)/);
        const supplyMatch = p.details.match(/Supply=\$(\d+)/);
        const sharesMatch = p.details.match(/Shares=\$(\d+)/);
        const val = depositsMatch?.[1] || stEthMatch?.[1] || supplyMatch?.[1] || sharesMatch?.[1] || '0';
        return BigInt(val);
      });

      // Parse actual from details string
      const actual = protocols.map(p => {
        const liqMatch = p.details.match(/Liq=\$(\d+)/);
        const borrowMatch = p.details.match(/Borrows=\$(\d+)/);
        const pooledMatch = p.details.match(/Pooled=(\d+)/);
        const assetsMatch = p.details.match(/Assets=\$(\d+)/);

        if (liqMatch && borrowMatch) return BigInt(liqMatch[1]) + BigInt(borrowMatch[1]);
        if (pooledMatch) return BigInt(pooledMatch[1]);
        if (assetsMatch) return BigInt(assetsMatch[1]);
        return 0n;
      });

      const solvencyRatios = protocols.map(p =>
        BigInt(Math.floor(parseFloat(p.solvency) * 100))
      );

      // Utilizations from workflow result (new field)
      const utilizations = protocols.map(p =>
        BigInt(p.utilizationBps ?? 0)
      );

      // Velocity data from workflow result (new fields)
      const velocityBps = protocols.map(p =>
        BigInt(p.velocityBps ?? 0)
      );

      const velocityNegative = protocols.map(p =>
        p.velocityNegative ?? false
      );

      console.log(`   📊 Submitting ${names.length} protocols with velocity data...`);

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
            velocityBps,
            velocityNegative,
          ],
        });

        console.log(`   📝 Protocol data tx: ${hash}`);

        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        console.log(`   ✅ Confirmed in block ${receipt.blockNumber}`);

        // Log any velocity alerts
        if (result.velocityAlerts && result.velocityAlerts.length > 0) {
          console.log(`   ⚡ ${result.velocityAlerts.length} velocity alert(s) submitted onchain:`);
          for (const v of result.velocityAlerts) {
            console.log(`      ${v.name}: ${(v.velocityBps / 100).toFixed(1)}%/cycle`);
          }
        }

        return { hash, blockNumber: Number(receipt.blockNumber) };
      } catch (err) {
        console.error(`   ❌ Onchain submit failed: ${err.message}`);
        return null;
      }
    },

    /**
     * Read dashboard data from oracle contract
     */
    async getDashboardData() {
      try {
        return await publicClient.readContract({
          address: oracleAddress,
          abi: ORACLE_ABI,
          functionName: 'getDashboardData',
        });
      } catch (err) {
        console.error(`❌ Read failed: ${err.message}`);
        return null;
      }
    },

    /**
     * Read statistics from oracle contract
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

    /**
     * Read velocity stats from oracle
     */
    async getVelocityStats() {
      try {
        const data = await publicClient.readContract({
          address: oracleAddress,
          abi: ORACLE_ABI,
          functionName: 'getVelocityStats',
        });
        return {
          totalAlerts: Number(data[0]),
          peakVelocityBps: Number(data[1]),
          peakProtocol: data[2],
          latestData: data[3],
        };
      } catch (err) {
        console.error(`❌ Velocity stats read failed: ${err.message}`);
        return null;
      }
    },

    /**
     * Read SentinalGuard status (if guard address provided)
     */
    async getGuardStatus() {
      if (!guardAddress) return null;
      try {
        const data = await publicClient.readContract({
          address: guardAddress,
          abi: GUARD_ABI,
          functionName: 'getGuardStatus',
        });
        return {
          globalPaused: data[0],
          severity: Number(data[1]),
          registered: Number(data[2]),
          pauseEvents: Number(data[3]),
          lastUpdate: Number(data[4]),
        };
      } catch (err) {
        console.error(`❌ Guard status read failed: ${err.message}`);
        return null;
      }
    },

    /**
     * Check if a specific protocol is safe via the guard
     */
    async isProtocolSafe(protocolName) {
      if (!guardAddress) return true;
      try {
        return await publicClient.readContract({
          address: guardAddress,
          abi: GUARD_ABI,
          functionName: 'isProtocolSafe',
          args: [protocolName],
        });
      } catch (err) {
        console.error(`❌ Guard safety check failed: ${err.message}`);
        return true; // fail open
      }
    },
  };
}
