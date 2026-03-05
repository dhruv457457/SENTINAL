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
 * @notice Receives DON-signed aggregate health reports from Chainlink CRE.
 *
 * V3 additions:
 *   - policyHash included in every report — cryptographic compliance trail
 *   - AttestationRegistry: runId → digest → policyHash (auditable history)
 *   - PolicyVersionActivated event for governance-ratified policy upgrades
 *   - Replay protection on onReport()
 *   - Timestamp freshness enforcement
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
        bytes32 policyHash;         // NEW: keccak256(SENTINAL_POLICY_CONFIG)
    }

    struct ProtocolReport {
        string  name;
        string  protocolType;
        string  chain;
        uint256 claimed;
        uint256 actual;
        uint256 solvencyRatio;
        uint256 utilization;
        uint256 velocityBps;
        bool    velocityNegative;
        uint256 timestamp;
    }

    struct ChainStats {
        uint256 totalReserves;
        uint256 totalClaimed;
        uint256 protocolCount;
        uint256 lastUpdated;
    }

    /// @notice AttestationRegistry entry — every enforcement event is
    ///         cryptographically bound to the policy version that triggered it.
    ///         Auditors can verify: "Action X was triggered by policy version Y
    ///         at timestamp Z with runId R."
    struct Attestation {
        bytes32 policyHash;     // keccak256 of policy config JSON
        uint256 riskScore;
        uint8   severity;
        uint256 timestamp;
        uint256 checkNumber;
        bool    anomalyDetected;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STATE
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    address public owner;
    address public forwarder;
    address public reporter;
    address public emergencyController;
    address public guard;

    // ── Aggregate (DON-signed via CRE) ──────────────
    HealthReport public latestReport;
    HealthReport[] public reportHistory;
    mapping(uint256 => HealthReport) public reports;

    // ── Per-Protocol ────────────────────────────────
    mapping(uint256 => mapping(uint256 => ProtocolReport)) public protocolReports;
    mapping(uint256 => uint256) public protocolCountPerCheck;
    mapping(bytes32 => ProtocolReport) public latestProtocolData;
    bytes32[] public trackedProtocols;
    mapping(bytes32 => bool) private protocolTracked;
    mapping(bytes32 => uint256) public previousUtilization;

    // ── Per-Chain ───────────────────────────────────
    mapping(bytes32 => ChainStats) public chainStats;
    bytes32[] public trackedChains;
    mapping(bytes32 => bool) private chainTracked;
    mapping(bytes32 => string) public chainNames;

    // ── AttestationRegistry ─────────────────────────
    // checkNumber → Attestation
    // Creates an immutable compliance trail:
    //   auditors can verify any historical enforcement event
    //   was triggered by a specific governance-ratified policy.
    mapping(uint256 => Attestation) public attestations;
    uint256[] public attestationIndex;

    // Active policy hash — set by governance when ratifying new policy
    bytes32 public activePolicyHash;
    string  public activePolicyVersion;

    // ── Replay Protection ───────────────────────────
    mapping(bytes32 => bool) private usedDigests;

    // ── Counters ────────────────────────────────────
    uint256 public totalChecks;
    uint256 public totalWarnings;
    uint256 public totalCritical;
    uint256 public totalAnomalies;
    uint256 public highestRiskScore;
    uint256 public highestRiskCheckNumber;
    uint256 public totalVelocityAlerts;
    uint256 public highestVelocityBps;
    string  public highestVelocityProtocol;

    // ── Freshness ───────────────────────────────────
    uint256 public constant MAX_REPORT_AGE = 3600; // 1 hour

    // ── Velocity ────────────────────────────────────
    uint256 public constant VELOCITY_ALERT_THRESHOLD = 500;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // EVENTS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    event ReportSubmitted(
        uint256 indexed checkNumber,
        uint256 timestamp,
        uint256 globalRatio,
        uint256 riskScore,
        uint8   severity,
        bool    anomalyDetected,
        bytes32 policyHash          // NEW
    );

    /// @notice Emitted for every check — immutable compliance trail
    event AttestationRecorded(
        uint256 indexed checkNumber,
        bytes32 indexed policyHash,
        uint8   severity,
        uint256 riskScore,
        uint256 timestamp
    );

    /// @notice Emitted when governance ratifies a new policy version
    event PolicyVersionActivated(
        bytes32 indexed policyHash,
        string  version,
        uint256 timestamp
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
        // ── Replay protection ──────────────────────
        bytes32 digest = keccak256(report);
        require(!usedDigests[digest], "Report already processed");
        usedDigests[digest] = true;

        (
            uint256 totalReservesUSD,
            uint256 totalClaimedUSD,
            uint256 globalRatio,
            uint256 riskScore,
            uint256 timestamp,
            uint256 checkNumber,
            uint8   severity,
            bool    anomalyDetected,
            bytes32 policyHash
        ) = abi.decode(report, (uint256, uint256, uint256, uint256, uint256, uint256, uint8, bool, bytes32));

        // ── Timestamp freshness ────────────────────
        require(
            block.timestamp <= timestamp + MAX_REPORT_AGE,
            "Report too old"
        );

        HealthReport memory healthReport = HealthReport({
            totalReservesUSD: totalReservesUSD,
            totalClaimedUSD:  totalClaimedUSD,
            globalRatio:      globalRatio,
            riskScore:        riskScore,
            timestamp:        timestamp,
            checkNumber:      checkNumber,
            severity:         severity,
            anomalyDetected:  anomalyDetected,
            policyHash:       policyHash
        });

        _processReport(healthReport);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // BACKEND ENTRY POINT — Per-Protocol + Velocity Data
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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
                name:             names[i],
                protocolType:     types[i],
                chain:            chains[i],
                claimed:          claimed[i],
                actual:           actual[i],
                solvencyRatio:    solvencyRatios[i],
                utilization:      utilizations[i],
                velocityBps:      velocityBps[i],
                velocityNegative: velocityNegative[i],
                timestamp:        ts
            });

            protocolReports[checkNumber][i] = pr;
            latestProtocolData[nameHash] = pr;
            previousUtilization[nameHash] = utilizations[i];

            if (!protocolTracked[nameHash]) {
                trackedProtocols.push(nameHash);
                protocolTracked[nameHash] = true;
            }

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

            if (velocityBps[i] >= VELOCITY_ALERT_THRESHOLD) {
                totalVelocityAlerts++;
                if (velocityBps[i] > highestVelocityBps) {
                    highestVelocityBps = velocityBps[i];
                    highestVelocityProtocol = names[i];
                }
                emit VelocityAlert(checkNumber, names[i], velocityBps[i], !velocityNegative[i], utilizations[i]);
            }

            if (guard != address(0)) {
                try ISentinalGuard(guard).updateProtocolStatus(names[i], solvencyRatios[i], checkNumber) {
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
    // GOVERNANCE — Policy Version Management
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    /// @notice Governance ratifies a new policy version.
    ///         After calling this, all future reports are verified against
    ///         this policyHash in the attestation registry.
    function activatePolicy(bytes32 policyHash, string calldata version) external onlyOwner {
        activePolicyHash = policyHash;
        activePolicyVersion = version;
        emit PolicyVersionActivated(policyHash, version, block.timestamp);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // VIEW — getPreviousUtilizations (CRE Call #8)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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
    // VIEW — Attestation Registry
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    /// @notice Fetch attestation for any historical check.
    ///         Auditors use this to verify: "Enforcement X was triggered
    ///         by policy version Y at timestamp Z."
    function getAttestation(uint256 checkNumber) external view returns (Attestation memory) {
        return attestations[checkNumber];
    }

    /// @notice Fetch last N attestations
    function getRecentAttestations(uint256 count) external view returns (Attestation[] memory) {
        uint256 len = attestationIndex.length;
        uint256 start = len > count ? len - count : 0;
        uint256 size = len - start;
        Attestation[] memory recent = new Attestation[](size);
        for (uint256 i = 0; i < size; i++) {
            recent[i] = attestations[attestationIndex[start + i]];
        }
        return recent;
    }

    /// @notice Verify that a historical enforcement used the active policy
    function verifyPolicyCompliance(uint256 checkNumber) external view returns (
        bool compliant,
        bytes32 reportPolicyHash,
        bytes32 currentPolicyHash
    ) {
        Attestation memory a = attestations[checkNumber];
        return (
            a.policyHash == activePolicyHash,
            a.policyHash,
            activePolicyHash
        );
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
        return (totalChecks, totalWarnings, totalCritical, totalAnomalies, latestReport.riskScore, highestRiskScore, highestRiskCheckNumber);
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
        return (latestReport, totalChecks, totalWarnings, totalCritical, totalAnomalies, pCount, trackedChains.length, allProtocols);
    }

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
        return (totalVelocityAlerts, highestVelocityBps, highestVelocityProtocol, allProtocols);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // TESTING — Simulation
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    function simulateHealthy() external {
        _processReport(HealthReport({
            totalReservesUSD: 4_608_879_987,
            totalClaimedUSD:  4_608_644_781,
            globalRatio:      10000,
            riskScore:        0,
            timestamp:        block.timestamp,
            checkNumber:      totalChecks + 1,
            severity:         0,
            anomalyDetected:  false,
            policyHash:       activePolicyHash
        }));
    }

    function simulateWarning() external {
        _processReport(HealthReport({
            totalReservesUSD: 4_100_000_000,
            totalClaimedUSD:  4_608_644_781,
            globalRatio:      8900,
            riskScore:        45,
            timestamp:        block.timestamp,
            checkNumber:      totalChecks + 1,
            severity:         1,
            anomalyDetected:  true,
            policyHash:       activePolicyHash
        }));
    }

    function simulateCritical() external {
        _processReport(HealthReport({
            totalReservesUSD: 3_500_000_000,
            totalClaimedUSD:  4_608_644_781,
            globalRatio:      7600,
            riskScore:        85,
            timestamp:        block.timestamp,
            checkNumber:      totalChecks + 1,
            severity:         2,
            anomalyDetected:  true,
            policyHash:       activePolicyHash
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

        // ── AttestationRegistry ────────────────────
        // Record cryptographic binding: enforcement → policy version
        Attestation memory attestation = Attestation({
            policyHash:     report.policyHash,
            riskScore:      report.riskScore,
            severity:       report.severity,
            timestamp:      report.timestamp,
            checkNumber:    report.checkNumber,
            anomalyDetected: report.anomalyDetected
        });
        attestations[report.checkNumber] = attestation;
        attestationIndex.push(report.checkNumber);

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
            report.anomalyDetected,
            report.policyHash
        );

        emit AttestationRecorded(
            report.checkNumber,
            report.policyHash,
            report.severity,
            report.riskScore,
            report.timestamp
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
