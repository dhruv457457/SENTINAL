// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./ISentinalGuard.sol";

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
 *         plus per-protocol solvency + velocity data from the SENTINAL backend.
 *
 * NEW in this version:
 *   - Stores per-protocol utilization for velocity detection by CRE workflow
 *   - Hooks into SentinalGuard for circuit-breaker updates
 *   - getPreviousUtilizations() — read by CRE as the 15th EVM call
 */
contract ReserveOracleV2 is IReceiver {

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // TYPES
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    struct HealthReport {
        uint256 totalReservesUSD;
        uint256 totalClaimedUSD;
        uint256 globalRatio;
        uint256 riskScore;
        uint256 timestamp;
        uint256 checkNumber;
        uint8   severity;
        bool    anomalyDetected;
    }

    struct ProtocolReport {
        string  name;
        string  protocolType;
        string  chain;
        uint256 claimed;
        uint256 actual;
        uint256 solvencyRatio;
        uint256 utilization;        // basis points (8700 = 87%)
        uint256 velocityBps;        // change in utilization since last check (signed stored as uint, see note)
        bool    velocityNegative;   // true if utilization decreased
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
    address public reporter;
    address public emergencyController;
    address public guard;               // NEW: SentinalGuard circuit breaker

    // ── Aggregate (DON-signed via CRE) ──────────────
    HealthReport public latestReport;
    HealthReport[] public reportHistory;
    mapping(uint256 => HealthReport) public reports;

    // ── Per-Protocol ────────────────────────────────
    mapping(uint256 => mapping(uint256 => ProtocolReport)) public protocolReports;
    mapping(uint256 => uint256) public protocolCountPerCheck;

    // keccak256(name) => ProtocolReport (latest)
    mapping(bytes32 => ProtocolReport) public latestProtocolData;
    bytes32[] public trackedProtocols;
    mapping(bytes32 => bool) private protocolTracked;

    // NEW: previous utilization per protocol for velocity calc in CRE workflow
    // keccak256(name) => utilization in basis points
    mapping(bytes32 => uint256) public previousUtilization;

    // ── Per-Chain ───────────────────────────────────
    mapping(bytes32 => ChainStats) public chainStats;
    bytes32[] public trackedChains;
    mapping(bytes32 => bool) private chainTracked;
    mapping(bytes32 => string) public chainNames;

    // ── Counters ────────────────────────────────────
    uint256 public totalChecks;
    uint256 public totalWarnings;
    uint256 public totalCritical;
    uint256 public totalAnomalies;
    uint256 public highestRiskScore;
    uint256 public highestRiskCheckNumber;

    // NEW: velocity alert counters
    uint256 public totalVelocityAlerts;
    uint256 public highestVelocityBps;
    string  public highestVelocityProtocol;

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

    // NEW
    event VelocityAlert(
        uint256 indexed checkNumber,
        string  name,
        uint256 velocityBps,
        bool    increasing,
        uint256 currentUtilization
    );

    event GuardUpdated(
        uint256 indexed checkNumber,
        uint8   severity,
        uint256 protocolsPaused
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
    // CONSTANTS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    /// @notice Velocity above this triggers an alert (5% per cycle in bps)
    uint256 public constant VELOCITY_ALERT_THRESHOLD = 500;

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
        reporter = msg.sender;
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
    // BACKEND ENTRY POINT — Per-Protocol + Velocity Data
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    /**
     * @notice Submit per-protocol solvency + velocity data.
     * @param velocityBps        Utilization change magnitude per protocol (basis points)
     * @param velocityNegative   True if utilization decreased (array parallel to names)
     */
    function submitProtocolData(
        uint256   checkNumber,
        string[]  calldata names,
        string[]  calldata types,
        string[]  calldata chains,
        uint256[] calldata claimed,
        uint256[] calldata actual,
        uint256[] calldata solvencyRatios,
        uint256[] calldata utilizations,
        uint256[] calldata velocityBps,
        bool[]    calldata velocityNegative
    ) external onlyReporter {
        uint256 count = names.length;
        require(count > 0, "Empty data");
        require(
            count == types.length &&
            count == chains.length &&
            count == claimed.length &&
            count == actual.length &&
            count == solvencyRatios.length &&
            count == utilizations.length &&
            count == velocityBps.length &&
            count == velocityNegative.length,
            "Array length mismatch"
        );

        uint256 ts = block.timestamp;
        uint256 protocolsPaused = 0;

        for (uint256 i = 0; i < count; i++) {
            bytes32 nameHash = keccak256(bytes(names[i]));

            ProtocolReport memory pr = ProtocolReport({
                name:            names[i],
                protocolType:    types[i],
                chain:           chains[i],
                claimed:         claimed[i],
                actual:          actual[i],
                solvencyRatio:   solvencyRatios[i],
                utilization:     utilizations[i],
                velocityBps:     velocityBps[i],
                velocityNegative: velocityNegative[i],
                timestamp:       ts
            });

            // Store per-check
            protocolReports[checkNumber][i] = pr;

            // Update latest
            latestProtocolData[nameHash] = pr;

            // Store current utilization as "previous" for NEXT check
            previousUtilization[nameHash] = utilizations[i];

            // Track protocol
            if (!protocolTracked[nameHash]) {
                trackedProtocols.push(nameHash);
                protocolTracked[nameHash] = true;
            }

            // Chain stats
            bytes32 chainHash = keccak256(bytes(chains[i]));
            if (!chainTracked[chainHash]) {
                trackedChains.push(chainHash);
                chainTracked[chainHash] = true;
                chainNames[chainHash] = chains[i];
            }
            ChainStats storage cs = chainStats[chainHash];
            if (cs.lastUpdated < ts - 1) {
                cs.totalReserves = 0;
                cs.totalClaimed = 0;
                cs.protocolCount = 0;
            }
            cs.totalReserves += actual[i];
            cs.totalClaimed += claimed[i];
            cs.protocolCount++;
            cs.lastUpdated = ts;

            // Velocity alert
            if (velocityBps[i] >= VELOCITY_ALERT_THRESHOLD) {
                totalVelocityAlerts++;
                if (velocityBps[i] > highestVelocityBps) {
                    highestVelocityBps = velocityBps[i];
                    highestVelocityProtocol = names[i];
                }
                emit VelocityAlert(
                    checkNumber,
                    names[i],
                    velocityBps[i],
                    !velocityNegative[i],
                    utilizations[i]
                );
            }

            // Update guard per-protocol
            if (guard != address(0)) {
                try ISentinalGuard(guard).updateProtocolStatus(
                    names[i],
                    solvencyRatios[i],
                    checkNumber
                ) {
                    if (solvencyRatios[i] < 9000) protocolsPaused++;
                } catch {}
            }

            emit ProtocolSolvencyUpdate(checkNumber, names[i], chains[i], solvencyRatios[i]);
        }

        protocolCountPerCheck[checkNumber] = count;

        if (protocolsPaused > 0) {
            emit GuardUpdated(checkNumber, latestReport.severity, protocolsPaused);
        }

        emit ProtocolDataSubmitted(checkNumber, count, trackedChains.length);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // NEW: Velocity Read — Called by CRE as call #15
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    /**
     * @notice Returns stored utilization values for given protocol names.
     *         CRE workflow calls this as its 15th EVM call to compute velocity.
     * @param names Array of SENTINAL protocol names (same order as config.protocols)
     * @return utils Array of previous utilization values in basis points
     */
    function getPreviousUtilizations(string[] calldata names)
        external
        view
        returns (uint256[] memory utils)
    {
        utils = new uint256[](names.length);
        for (uint256 i = 0; i < names.length; i++) {
            utils[i] = previousUtilization[keccak256(bytes(names[i]))];
        }
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
    // VIEW — Dashboard
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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

    /**
     * @notice Velocity-focused dashboard view.
     */
    function getVelocityStats() external view returns (
        uint256 totalAlerts,
        uint256 peakVelocityBps,
        string memory peakProtocol,
        ProtocolReport[] memory latestData
    ) {
        uint256 pCount = trackedProtocols.length;
        ProtocolReport[] memory allProtocols = new ProtocolReport[](pCount);
        for (uint256 i = 0; i < pCount; i++) {
            allProtocols[i] = latestProtocolData[trackedProtocols[i]];
        }
        return (
            totalVelocityAlerts,
            highestVelocityBps,
            highestVelocityProtocol,
            allProtocols
        );
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // TESTING — Simulation
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

    /// @notice NEW — Link SentinalGuard for circuit breaker updates
    function setGuard(address _guard) external onlyOwner {
        guard = _guard;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        owner = newOwner;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // INTERNAL
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    function _processReport(HealthReport memory report) internal {
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

        // Update SentinalGuard global status
        if (guard != address(0)) {
            try ISentinalGuard(guard).updateGlobalStatus(report.severity) {} catch {}
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
                emit EmergencyTriggered(report.checkNumber, report.riskScore, "Critical risk detected");
            }
        }
    }
}
