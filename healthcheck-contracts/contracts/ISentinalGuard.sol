// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title ISentinalGuard
 * @notice Interface for the SENTINAL circuit breaker.
 *         Any DeFi protocol integrates this to get automatic
 *         risk-gated protection from SENTINAL health checks.
 *
 * Usage (integrate in 3 lines):
 *
 *   ISentinalGuard constant GUARD = ISentinalGuard(0x...);
 *
 *   function deposit(uint256 amount) external {
 *       require(GUARD.isSafe(address(this)), "SENTINAL: protocol paused");
 *       ...
 *   }
 */
interface ISentinalGuard {

    // ── Events ───────────────────────────────────

    event Registered(address indexed protocol, string[] watchedProtocols);
    event Deregistered(address indexed protocol);
    event GlobalStatusUpdated(uint8 severity, bool paused);
    event ProtocolStatusUpdated(string indexed name, uint256 solvency, bool paused);
    event GuardTriggered(string reason, uint256 affectedCount);

    // ── Registration ─────────────────────────────

    /**
     * @notice Register your contract to be protected by SENTINAL.
     * @param watchedProtocols List of SENTINAL protocol names to watch.
     *        e.g. ["Aave V3 USDC (Ethereum)", "Lido stETH"]
     *        If ANY watched protocol is paused, isSafe returns false.
     */
    function register(string[] calldata watchedProtocols) external;

    /**
     * @notice Deregister — isSafe will always return true after this.
     */
    function deregister() external;

    // ── Safety Checks ─────────────────────────────

    /**
     * @notice Check if a registered address is safe to operate.
     * @param protocol The address of the protocol to check.
     * @return true if safe (no global pause AND no watched-protocol pause).
     */
    function isSafe(address protocol) external view returns (bool);

    /**
     * @notice Check if a specific SENTINAL-tracked protocol is safe by name.
     * @param protocolName The SENTINAL name, e.g. "Aave V3 USDC (Ethereum)".
     */
    function isProtocolSafe(string calldata protocolName) external view returns (bool);

    /**
     * @notice Returns true if a global pause is active (CRITICAL severity).
     */
    function isGloballyPaused() external view returns (bool);

    // ── Oracle-only Status Updates ─────────────────

    /**
     * @notice Called by ReserveOracleV2 after each aggregate health report.
     * @param severity 0=HEALTHY, 1=WARNING, 2=CRITICAL
     */
    function updateGlobalStatus(uint8 severity) external;

    /**
     * @notice Called by ReserveOracleV2 for each protocol after submitProtocolData.
     * @param name        SENTINAL protocol name
     * @param solvency    Solvency ratio in basis points (10000 = 100%)
     * @param checkNumber Sequential check ID
     */
    function updateProtocolStatus(
        string calldata name,
        uint256 solvency,
        uint256 checkNumber
    ) external;

    // ── View ──────────────────────────────────────

    function getRegistration(address protocol) external view returns (
        bool active,
        string[] memory watchedProtocols,
        uint256 registeredAt
    );

    function totalRegistered() external view returns (uint256);
}
