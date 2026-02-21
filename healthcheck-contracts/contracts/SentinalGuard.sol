// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./ISentinalGuard.sol";

/**
 * @title SentinalGuard
 * @author SENTINAL — Multi-Chain DeFi Health Monitor
 * @notice Open-registry circuit breaker. Any DeFi protocol calls register()
 *         to opt-in. SENTINAL's oracle automatically pauses registered
 *         protocols when risk thresholds are breached.
 *
 * Trigger conditions:
 *   Global pause  → severity == 2 (CRITICAL)
 *   Protocol pause → per-protocol solvency drops below SOLVENCY_PAUSE_THRESHOLD
 *   Protocol warn  → per-protocol solvency drops below SOLVENCY_WARN_THRESHOLD
 *
 * Integration (3 lines):
 *   ISentinalGuard constant GUARD = ISentinalGuard(GUARD_ADDRESS);
 *   string[] memory watched = new string[](1);
 *   watched[0] = "Aave V3 USDC (Ethereum)";
 *   GUARD.register(watched);
 *
 *   // In your deposit/withdraw:
 *   require(GUARD.isSafe(address(this)), "SENTINAL: circuit breaker active");
 */
contract SentinalGuard is ISentinalGuard {

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // CONSTANTS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    /// @notice Solvency below this → pause (90% in basis points)
    uint256 public constant SOLVENCY_PAUSE_THRESHOLD = 9000;

    /// @notice Solvency below this → warning but not pause (95%)
    uint256 public constant SOLVENCY_WARN_THRESHOLD = 9500;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // TYPES
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    struct Registration {
        bool active;
        string[] watchedProtocols;
        uint256 registeredAt;
        uint256 pauseCount;         // how many times this address was paused
    }

    struct ProtocolStatus {
        bool paused;
        bool warning;
        uint256 solvency;           // basis points
        uint256 lastCheckNumber;
        uint256 lastUpdated;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STATE
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    address public owner;
    address public oracle;          // ReserveOracleV2 — only it can update status

    bool    public globalPaused;
    uint8   public currentSeverity;
    uint256 public totalPauseEvents;
    uint256 public lastGlobalUpdate;

    // address => Registration
    mapping(address => Registration) private _registrations;
    address[] private _registeredList;
    uint256 public totalRegisteredCount;

    // keccak256(protocolName) => ProtocolStatus
    mapping(bytes32 => ProtocolStatus) private _protocolStatus;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // MODIFIERS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    modifier onlyOwner() {
        require(msg.sender == owner, "SentinalGuard: not owner");
        _;
    }

    modifier onlyOracle() {
        require(msg.sender == oracle, "SentinalGuard: not oracle");
        _;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // CONSTRUCTOR
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    constructor() {
        owner = msg.sender;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // REGISTRATION — Open to anyone
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    /**
     * @notice Register msg.sender as a SENTINAL-protected protocol.
     * @param watchedProtocols SENTINAL names to watch. If any are paused,
     *        isSafe(msg.sender) returns false.
     *        Pass empty array to only react to global CRITICAL events.
     */
    function register(string[] calldata watchedProtocols) external override {
        require(watchedProtocols.length <= 10, "SentinalGuard: max 10 watched protocols");

        Registration storage reg = _registrations[msg.sender];

        if (!reg.active) {
            _registeredList.push(msg.sender);
            totalRegisteredCount++;
        }

        reg.active = true;
        reg.registeredAt = block.timestamp;

        // Replace watched protocols
        delete reg.watchedProtocols;
        for (uint256 i = 0; i < watchedProtocols.length; i++) {
            reg.watchedProtocols.push(watchedProtocols[i]);
        }

        emit Registered(msg.sender, watchedProtocols);
    }

    /**
     * @notice Deregister — isSafe will always return true after this.
     */
    function deregister() external override {
        require(_registrations[msg.sender].active, "SentinalGuard: not registered");
        _registrations[msg.sender].active = false;
        totalRegisteredCount--;
        emit Deregistered(msg.sender);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // SAFETY CHECKS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    /**
     * @notice Main safety gate. Returns false if:
     *   - Not registered (treat as safe — opt-in model)
     *   - Global CRITICAL pause is active
     *   - Any watched protocol is individually paused
     */
    function isSafe(address protocol) external view override returns (bool) {
        Registration storage reg = _registrations[protocol];

        // Not registered = safe (opt-in model, don't break non-integrated protocols)
        if (!reg.active) return true;

        // Global CRITICAL pause
        if (globalPaused) return false;

        // Check each watched protocol
        for (uint256 i = 0; i < reg.watchedProtocols.length; i++) {
            bytes32 nameHash = keccak256(bytes(reg.watchedProtocols[i]));
            if (_protocolStatus[nameHash].paused) return false;
        }

        return true;
    }

    /**
     * @notice Check a SENTINAL protocol by name directly.
     */
    function isProtocolSafe(string calldata protocolName) external view override returns (bool) {
        if (globalPaused) return false;
        bytes32 nameHash = keccak256(bytes(protocolName));
        return !_protocolStatus[nameHash].paused;
    }

    function isGloballyPaused() external view override returns (bool) {
        return globalPaused;
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ORACLE STATUS UPDATES
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    /**
     * @notice Called by ReserveOracleV2 after each aggregate report.
     *         CRITICAL → global pause. HEALTHY/WARNING → unpause global.
     */
    function updateGlobalStatus(uint8 severity) external override onlyOracle {
        uint8 prevSeverity = currentSeverity;
        currentSeverity = severity;
        lastGlobalUpdate = block.timestamp;

        bool wasGlobalPaused = globalPaused;
        globalPaused = (severity == 2);

        if (globalPaused && !wasGlobalPaused) {
            totalPauseEvents++;
            emit GuardTriggered("GLOBAL CRITICAL", totalRegisteredCount);
        }

        emit GlobalStatusUpdated(severity, globalPaused);
    }

    /**
     * @notice Called by ReserveOracleV2 for each protocol after submitProtocolData.
     *         Pauses if solvency < SOLVENCY_PAUSE_THRESHOLD (90%).
     */
    function updateProtocolStatus(
        string calldata name,
        uint256 solvency,
        uint256 checkNumber
    ) external override onlyOracle {
        bytes32 nameHash = keccak256(bytes(name));
        ProtocolStatus storage ps = _protocolStatus[nameHash];

        bool wasPaused = ps.paused;

        ps.solvency = solvency;
        ps.lastCheckNumber = checkNumber;
        ps.lastUpdated = block.timestamp;
        ps.warning = solvency < SOLVENCY_WARN_THRESHOLD;
        ps.paused = solvency < SOLVENCY_PAUSE_THRESHOLD;

        if (ps.paused && !wasPaused) {
            totalPauseEvents++;
            // Count how many registered protocols watch this
            uint256 affected = _countAffected(nameHash);
            emit GuardTriggered(name, affected);
        }

        emit ProtocolStatusUpdated(name, solvency, ps.paused);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // VIEW
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    function getRegistration(address protocol) external view override returns (
        bool active,
        string[] memory watchedProtocols,
        uint256 registeredAt
    ) {
        Registration storage reg = _registrations[protocol];
        return (reg.active, reg.watchedProtocols, reg.registeredAt);
    }

    function totalRegistered() external view override returns (uint256) {
        return totalRegisteredCount;
    }

    function getProtocolStatus(string calldata name) external view returns (
        bool paused,
        bool warning,
        uint256 solvency,
        uint256 lastCheckNumber,
        uint256 lastUpdated
    ) {
        ProtocolStatus storage ps = _protocolStatus[keccak256(bytes(name))];
        return (ps.paused, ps.warning, ps.solvency, ps.lastCheckNumber, ps.lastUpdated);
    }

    function getRegisteredList(uint256 offset, uint256 limit) external view returns (address[] memory) {
        uint256 total = _registeredList.length;
        if (offset >= total) return new address[](0);
        uint256 end = offset + limit > total ? total : offset + limit;
        address[] memory result = new address[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            result[i - offset] = _registeredList[i];
        }
        return result;
    }

    /**
     * @notice Dashboard helper — get full status in one call.
     */
    function getGuardStatus() external view returns (
        bool _globalPaused,
        uint8 _severity,
        uint256 _registered,
        uint256 _pauseEvents,
        uint256 _lastUpdate
    ) {
        return (globalPaused, currentSeverity, totalRegisteredCount, totalPauseEvents, lastGlobalUpdate);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ADMIN
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    function setOracle(address _oracle) external onlyOwner {
        require(_oracle != address(0), "SentinalGuard: zero address");
        oracle = _oracle;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "SentinalGuard: zero address");
        owner = newOwner;
    }

    /**
     * @notice Owner can manually unpause in an emergency.
     */
    function manualUnpause(string calldata protocolName) external onlyOwner {
        if (bytes(protocolName).length == 0) {
            globalPaused = false;
            emit GlobalStatusUpdated(currentSeverity, false);
        } else {
            bytes32 nameHash = keccak256(bytes(protocolName));
            _protocolStatus[nameHash].paused = false;
            emit ProtocolStatusUpdated(protocolName, _protocolStatus[nameHash].solvency, false);
        }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // INTERNAL
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    function _countAffected(bytes32 nameHash) internal view returns (uint256 count) {
        for (uint256 i = 0; i < _registeredList.length; i++) {
            Registration storage reg = _registrations[_registeredList[i]];
            if (!reg.active) continue;
            for (uint256 j = 0; j < reg.watchedProtocols.length; j++) {
                if (keccak256(bytes(reg.watchedProtocols[j])) == nameHash) {
                    count++;
                    break;
                }
            }
        }
    }
}
