// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title IReceiver - Chainlink CRE Receiver Interface
 */
interface IReceiver {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

/**
 * @title ReserveOracleV2
 * @author SENTINAL — Multi-Chain DeFi Health Monitor
 * @notice Receives DON-signed aggregate health reports from Chainlink CRE,
 *         plus per-protocol solvency data from the SENTINAL backend.
 *         All data is queryable on Etherscan for full transparency.
 *
 * Architecture:
 *   CRE Workflow (DON-signed) → onReport()          → Aggregate health data
 *   SENTINAL Backend          → submitProtocolData() → Per-protocol details
 */
contract ReserveOracleV2 is IReceiver {

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // TYPES
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    struct HealthReport {
        uint256 totalReservesUSD;     // Actual reserves backing deposits
        uint256 totalClaimedUSD;      // Total user deposits claimed
        uint256 globalRatio;          // Worst solvency ratio (basis points, 10000 = 100%)
        uint256 riskScore;            // 0-100 risk score
        uint256 timestamp;            // DON consensus timestamp
        uint256 checkNumber;          // Sequential check ID
        uint8   severity;             // 0=HEALTHY, 1=WARNING, 2=CRITICAL
        bool    anomalyDetected;      // Cross-reference anomaly flag
    }

    struct ProtocolReport {
        string  name;                 // e.g. "Aave V3 USDC (Ethereum)"
        string  protocolType;         // e.g. "aave", "lido", "compound"
        string  chain;                // e.g. "ethereum-mainnet"
        uint256 claimed;              // Deposits/shares (USD or ETH depending on type)
        uint256 actual;               // Actual backing (USD or ETH)
        uint256 solvencyRatio;        // Basis points (10000 = 100%)
        uint256 utilization;          // Basis points (8700 = 87%)
        uint256 timestamp;
    }

    struct ChainStats {
        uint256 totalReserves;
        uint256 totalClaimed;
        uint256 protocolCount;
        uint256 lastUpdated;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STATE
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    address public owner;
    address public forwarder;
    address public reporter;              // Backend address authorized to submit protocol data
    address public emergencyController;

    // ── Aggregate (DON-signed via CRE) ──────────────
    HealthReport public latestReport;
    HealthReport[] public reportHistory;
    mapping(uint256 => HealthReport) public reports;

    // ── Per-Protocol ────────────────────────────────
    // checkNumber => protocol index => ProtocolReport
    mapping(uint256 => mapping(uint256 => ProtocolReport)) public protocolReports;
    mapping(uint256 => uint256) public protocolCountPerCheck;

    // Latest per-protocol data (always up to date)
    // keccak256(name) => ProtocolReport
    mapping(bytes32 => ProtocolReport) public latestProtocolData;
    bytes32[] public trackedProtocols;
    mapping(bytes32 => bool) private protocolTracked;

    // ── Per-Chain ───────────────────────────────────
    // keccak256(chainName) => ChainStats
    mapping(bytes32 => ChainStats) public chainStats;
    bytes32[] public trackedChains;
    mapping(bytes32 => bool) private chainTracked;
    mapping(bytes32 => string) public chainNames;      // hash => readable name

    // ── Counters ────────────────────────────────────
    uint256 public totalChecks;
    uint256 public totalWarnings;
    uint256 public totalCritical;
    uint256 public totalAnomalies;
    uint256 public highestRiskScore;
    uint256 public highestRiskCheckNumber;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // EVENTS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    event ReportSubmitted(
        uint256 indexed checkNumber,
        uint256 timestamp,
        uint256 globalRatio,
        uint256 riskScore,
        uint8   severity,
        bool    anomalyDetected
    );

    event ProtocolDataSubmitted(
        uint256 indexed checkNumber,
        uint256 protocolCount,
        uint256 chainCount
    );

    event ProtocolSolvencyUpdate(
        uint256 indexed checkNumber,
        string  name,
        string  chain,
        uint256 solvencyRatio
    );

    event EmergencyTriggered(
        uint256 indexed checkNumber,
        uint256 riskScore,
        string  reason
    );

    event SeverityChanged(
        uint256 indexed checkNumber,
        uint8   previousSeverity,
        uint8   newSeverity
    );

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // MODIFIERS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyForwarder() {
        require(msg.sender == forwarder, "Not authorized forwarder");
        _;
    }

    modifier onlyReporter() {
        require(msg.sender == reporter || msg.sender == owner, "Not authorized reporter");
        _;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // CONSTRUCTOR
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    constructor(address _forwarder) {
        owner = msg.sender;
        forwarder = _forwarder;
        reporter = msg.sender;  // Owner is default reporter
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // CRE ENTRY POINT — DON-Signed Aggregate Report
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    function onReport(bytes calldata metadata, bytes calldata report) external override onlyForwarder {
        (
            uint256 totalReservesUSD,
            uint256 totalClaimedUSD,
            uint256 globalRatio,
            uint256 riskScore,
            uint256 timestamp,
            uint256 checkNumber,
            uint8   severity,
            bool    anomalyDetected
        ) = abi.decode(report, (uint256, uint256, uint256, uint256, uint256, uint256, uint8, bool));

        HealthReport memory healthReport = HealthReport({
            totalReservesUSD: totalReservesUSD,
            totalClaimedUSD: totalClaimedUSD,
            globalRatio: globalRatio,
            riskScore: riskScore,
            timestamp: timestamp,
            checkNumber: checkNumber,
            severity: severity,
            anomalyDetected: anomalyDetected
        });

        _processReport(healthReport);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // BACKEND ENTRY POINT — Per-Protocol Details
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    /**
     * @notice Submit per-protocol solvency data for a given check
     * @dev Called by the SENTINAL backend after each CRE workflow run
     * @param checkNumber Must match an existing aggregate report
     * @param names       Protocol display names
     * @param types       Protocol types (aave, lido, compound, erc4626)
     * @param chains      Chain selector names
     * @param claimed     Claimed deposits per protocol
     * @param actual      Actual reserves per protocol
     * @param solvencyRatios  Solvency in basis points per protocol
     * @param utilizations    Utilization in basis points per protocol
     */
    function submitProtocolData(
        uint256   checkNumber,
        string[]  calldata names,
        string[]  calldata types,
        string[]  calldata chains,
        uint256[] calldata claimed,
        uint256[] calldata actual,
        uint256[] calldata solvencyRatios,
        uint256[] calldata utilizations
    ) external onlyReporter {
        uint256 count = names.length;
        require(count > 0, "Empty data");
        require(
            count == types.length &&
            count == chains.length &&
            count == claimed.length &&
            count == actual.length &&
            count == solvencyRatios.length &&
            count == utilizations.length,
            "Array length mismatch"
        );

        uint256 ts = block.timestamp;
        uint256 chainCount = 0;

        for (uint256 i = 0; i < count; i++) {
            ProtocolReport memory pr = ProtocolReport({
                name: names[i],
                protocolType: types[i],
                chain: chains[i],
                claimed: claimed[i],
                actual: actual[i],
                solvencyRatio: solvencyRatios[i],
                utilization: utilizations[i],
                timestamp: ts
            });

            // Store per-check
            protocolReports[checkNumber][i] = pr;

            // Update latest per-protocol
            bytes32 nameHash = keccak256(bytes(names[i]));
            latestProtocolData[nameHash] = pr;
            if (!protocolTracked[nameHash]) {
                trackedProtocols.push(nameHash);
                protocolTracked[nameHash] = true;
            }

            // Update chain stats
            bytes32 chainHash = keccak256(bytes(chains[i]));
            if (!chainTracked[chainHash]) {
                trackedChains.push(chainHash);
                chainTracked[chainHash] = true;
                chainNames[chainHash] = chains[i];
                chainCount++;
            }

            ChainStats storage cs = chainStats[chainHash];
            // Reset if this is a new check cycle
            if (cs.lastUpdated < ts - 1) {
                cs.totalReserves = 0;
                cs.totalClaimed = 0;
                cs.protocolCount = 0;
            }
            cs.totalReserves += actual[i];
            cs.totalClaimed += claimed[i];
            cs.protocolCount++;
            cs.lastUpdated = ts;

            emit ProtocolSolvencyUpdate(checkNumber, names[i], chains[i], solvencyRatios[i]);
        }

        protocolCountPerCheck[checkNumber] = count;

        emit ProtocolDataSubmitted(checkNumber, count, trackedChains.length);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // VIEW — Aggregate
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    function getLatestReport() external view returns (HealthReport memory) {
        return latestReport;
    }

    function getReport(uint256 checkNumber) external view returns (HealthReport memory) {
        return reports[checkNumber];
    }

    function getReportHistory(uint256 count) external view returns (HealthReport[] memory) {
        uint256 len = reportHistory.length;
        uint256 start = len > count ? len - count : 0;
        uint256 size = len - start;
        HealthReport[] memory recent = new HealthReport[](size);
        for (uint256 i = 0; i < size; i++) {
            recent[i] = reportHistory[start + i];
        }
        return recent;
    }

    function getStatistics() external view returns (
        uint256 checks,
        uint256 warnings,
        uint256 criticals,
        uint256 anomalies,
        uint256 currentRisk,
        uint256 peakRisk,
        uint256 peakRiskCheck
    ) {
        return (
            totalChecks,
            totalWarnings,
            totalCritical,
            totalAnomalies,
            latestReport.riskScore,
            highestRiskScore,
            highestRiskCheckNumber
        );
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // VIEW — Per-Protocol
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    function getProtocolReports(uint256 checkNumber) external view returns (ProtocolReport[] memory) {
        uint256 count = protocolCountPerCheck[checkNumber];
        ProtocolReport[] memory result = new ProtocolReport[](count);
        for (uint256 i = 0; i < count; i++) {
            result[i] = protocolReports[checkNumber][i];
        }
        return result;
    }

    function getProtocolByName(string calldata name) external view returns (ProtocolReport memory) {
        return latestProtocolData[keccak256(bytes(name))];
    }

    function getTrackedProtocolCount() external view returns (uint256) {
        return trackedProtocols.length;
    }

    function getAllLatestProtocols() external view returns (ProtocolReport[] memory) {
        uint256 count = trackedProtocols.length;
        ProtocolReport[] memory result = new ProtocolReport[](count);
        for (uint256 i = 0; i < count; i++) {
            result[i] = latestProtocolData[trackedProtocols[i]];
        }
        return result;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // VIEW — Per-Chain
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    function getChainStats(string calldata chainName) external view returns (ChainStats memory) {
        return chainStats[keccak256(bytes(chainName))];
    }

    function getTrackedChainCount() external view returns (uint256) {
        return trackedChains.length;
    }

    function getAllChainStats() external view returns (string[] memory names, ChainStats[] memory stats) {
        uint256 count = trackedChains.length;
        names = new string[](count);
        stats = new ChainStats[](count);
        for (uint256 i = 0; i < count; i++) {
            names[i] = chainNames[trackedChains[i]];
            stats[i] = chainStats[trackedChains[i]];
        }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // VIEW — Dashboard Helpers
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    /**
     * @notice Single call to get everything a dashboard needs
     */
    function getDashboardData() external view returns (
        HealthReport memory latest,
        uint256 checks,
        uint256 warnings,
        uint256 criticals,
        uint256 anomalies,
        uint256 protocolCount,
        uint256 chainCount,
        ProtocolReport[] memory protocols
    ) {
        uint256 pCount = trackedProtocols.length;
        ProtocolReport[] memory allProtocols = new ProtocolReport[](pCount);
        for (uint256 i = 0; i < pCount; i++) {
            allProtocols[i] = latestProtocolData[trackedProtocols[i]];
        }

        return (
            latestReport,
            totalChecks,
            totalWarnings,
            totalCritical,
            totalAnomalies,
            pCount,
            trackedChains.length,
            allProtocols
        );
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // TESTING — Simulation functions
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    function simulateHealthy() external {
        _processReport(HealthReport({
            totalReservesUSD: 4_608_879_987,
            totalClaimedUSD: 4_608_644_781,
            globalRatio: 10000,
            riskScore: 0,
            timestamp: block.timestamp,
            checkNumber: totalChecks + 1,
            severity: 0,
            anomalyDetected: false
        }));
    }

    function simulateWarning() external {
        _processReport(HealthReport({
            totalReservesUSD: 4_100_000_000,
            totalClaimedUSD: 4_608_644_781,
            globalRatio: 8900,
            riskScore: 45,
            timestamp: block.timestamp,
            checkNumber: totalChecks + 1,
            severity: 1,
            anomalyDetected: true
        }));
    }

    function simulateCritical() external {
        _processReport(HealthReport({
            totalReservesUSD: 3_500_000_000,
            totalClaimedUSD: 4_608_644_781,
            globalRatio: 7600,
            riskScore: 85,
            timestamp: block.timestamp,
            checkNumber: totalChecks + 1,
            severity: 2,
            anomalyDetected: true
        }));
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ADMIN
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    function setForwarder(address _forwarder) external onlyOwner {
        forwarder = _forwarder;
    }

    function setReporter(address _reporter) external onlyOwner {
        reporter = _reporter;
    }

    function setEmergencyController(address _controller) external onlyOwner {
        emergencyController = _controller;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        owner = newOwner;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // INTERNAL
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    function _processReport(HealthReport memory report) internal {
        // Track severity changes
        if (totalChecks > 0 && latestReport.severity != report.severity) {
            emit SeverityChanged(report.checkNumber, latestReport.severity, report.severity);
        }

        latestReport = report;
        reports[report.checkNumber] = report;
        reportHistory.push(report);

        totalChecks++;
        if (report.severity == 1) totalWarnings++;
        if (report.severity == 2) totalCritical++;
        if (report.anomalyDetected) totalAnomalies++;

        if (report.riskScore > highestRiskScore) {
            highestRiskScore = report.riskScore;
            highestRiskCheckNumber = report.checkNumber;
        }

        emit ReportSubmitted(
            report.checkNumber,
            report.timestamp,
            report.globalRatio,
            report.riskScore,
            report.severity,
            report.anomalyDetected
        );

        if (report.severity == 2 || report.riskScore >= 80) {
            _triggerEmergency(report);
        }
    }

    function _triggerEmergency(HealthReport memory report) internal {
        if (emergencyController != address(0)) {
            (bool success, ) = emergencyController.call(
                abi.encodeWithSignature(
                    "executeEmergency(uint256,uint256)",
                    report.riskScore,
                    report.globalRatio
                )
            );

            if (success) {
                emit EmergencyTriggered(
                    report.checkNumber,
                    report.riskScore,
                    "Critical risk detected"
                );
            }
        }
    }
}
