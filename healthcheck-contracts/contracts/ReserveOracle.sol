// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title IReceiver - Chainlink CRE Receiver Interface
 * @notice Your contract must implement this to receive reports from CRE via the Forwarder
 */
interface IReceiver {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

/**
 * @title ReserveOracleV2
 * @notice CRE-compatible reserve health oracle that receives reports via Chainlink's KeystoneForwarder
 * @dev Implements IReceiver directly. The Forwarder verifies DON signatures before calling onReport().
 */
contract ReserveOracleV2 is IReceiver {

    address public owner;
    address public forwarder;          // Chainlink KeystoneForwarder address
    address public emergencyController;

    struct HealthReport {
        uint256 totalReservesUSD;
        uint256 totalClaimedUSD;
        uint256 globalRatio;
        uint256 riskScore;
        uint256 timestamp;
        uint256 checkNumber;
        uint8 severity;
        bool anomalyDetected;
    }

    HealthReport public latestReport;
    HealthReport[] public reportHistory;
    mapping(uint256 => HealthReport) public reports;

    uint256 public totalChecks;
    uint256 public totalWarnings;
    uint256 public totalCritical;

    // ── Events ──────────────────────────────────────────
    event ReportSubmitted(
        uint256 indexed checkNumber,
        uint256 timestamp,
        uint256 globalRatio,
        uint256 riskScore,
        uint8 severity,
        bool anomalyDetected
    );

    event EmergencyTriggered(
        uint256 checkNumber,
        uint256 riskScore,
        string reason
    );

    // ── Modifiers ───────────────────────────────────────
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyForwarder() {
        require(msg.sender == forwarder, "Not authorized forwarder");
        _;
    }

    // ── Constructor ─────────────────────────────────────
    constructor(address _forwarder) {
        owner = msg.sender;
        forwarder = _forwarder;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // CRE ENTRY POINT - Called by Chainlink Forwarder
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    /**
     * @notice Called by the Chainlink KeystoneForwarder after verifying DON signatures
     * @param metadata CRE metadata (workflow ID, DON ID, etc.) - available for access control
     * @param report   ABI-encoded HealthReport struct from CRE workflow
     */
    function onReport(bytes calldata metadata, bytes calldata report) external override onlyForwarder {
        // Decode the ABI-encoded HealthReport from CRE workflow
        (
            uint256 totalReservesUSD,
            uint256 totalClaimedUSD,
            uint256 globalRatio,
            uint256 riskScore,
            uint256 timestamp,
            uint256 checkNumber,
            uint8 severity,
            bool anomalyDetected
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
    // TESTING - Direct submit (for local testing only)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    function simulateHealthy() external {
        _processReport(HealthReport({
            totalReservesUSD: 95_000_000,
            totalClaimedUSD: 100_000_000,
            globalRatio: 9500,
            riskScore: 20,
            timestamp: block.timestamp,
            checkNumber: totalChecks + 1,
            severity: 0,
            anomalyDetected: false
        }));
    }

    function simulateWarning() external {
        _processReport(HealthReport({
            totalReservesUSD: 85_000_000,
            totalClaimedUSD: 100_000_000,
            globalRatio: 8500,
            riskScore: 55,
            timestamp: block.timestamp,
            checkNumber: totalChecks + 1,
            severity: 1,
            anomalyDetected: true
        }));
    }

    function simulateCritical() external {
        _processReport(HealthReport({
            totalReservesUSD: 75_000_000,
            totalClaimedUSD: 100_000_000,
            globalRatio: 7500,
            riskScore: 85,
            timestamp: block.timestamp,
            checkNumber: totalChecks + 1,
            severity: 2,
            anomalyDetected: true
        }));
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // VIEW FUNCTIONS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    function getLatestReport() external view returns (HealthReport memory) {
        return latestReport;
    }

    function getReportHistory(uint256 count) external view returns (HealthReport[] memory) {
        uint256 start = reportHistory.length > count ? reportHistory.length - count : 0;
        uint256 size = reportHistory.length - start;
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
        uint256 currentRisk
    ) {
        return (totalChecks, totalWarnings, totalCritical, latestReport.riskScore);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ADMIN
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    function setForwarder(address _forwarder) external onlyOwner {
        forwarder = _forwarder;
    }

    function setEmergencyController(address _controller) external onlyOwner {
        emergencyController = _controller;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // INTERNAL
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    function _processReport(HealthReport memory report) internal {
        latestReport = report;
        reports[report.checkNumber] = report;
        reportHistory.push(report);

        totalChecks++;
        if (report.severity == 1) totalWarnings++;
        if (report.severity == 2) totalCritical++;

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
