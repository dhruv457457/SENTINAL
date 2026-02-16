// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title EmergencyController
 * @notice Executes emergency actions when triggered by Oracle
 * @dev Simple execution layer - CRE decides, this executes
 */
contract EmergencyController {
    
    address public owner;
    address public oracle;
    
    bool public isPaused;
    uint256 public lastPauseTime;
    uint256 public pauseCount;
    
    // Emergency actions log
    struct EmergencyAction {
        uint256 timestamp;
        uint256 riskScore;
        uint256 ratio;
        string action;
    }
    
    EmergencyAction[] public actionHistory;
    
    event ProtocolPaused(uint256 timestamp, uint256 riskScore, uint256 ratio);
    event ProtocolResumed(uint256 timestamp, address by);
    event EmergencyExecuted(string action, uint256 riskScore);
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }
    
    modifier onlyOracle() {
        require(msg.sender == oracle, "Not oracle");
        _;
    }
    
    constructor() {
        owner = msg.sender;
    }
    
    /**
     * @notice Execute emergency response (called by Oracle)
     * @param riskScore Risk score from CRE (0-100)
     * @param ratio Global reserve ratio (basis points)
     */
    function executeEmergency(
        uint256 riskScore,
        uint256 ratio
    ) external onlyOracle {
        
        if (riskScore >= 80 || ratio < 8000) {
            // CRITICAL: Pause everything
            _pauseProtocol(riskScore, ratio);
            
            actionHistory.push(EmergencyAction({
                timestamp: block.timestamp,
                riskScore: riskScore,
                ratio: ratio,
                action: "PAUSE_ALL"
            }));
            
        } else if (riskScore >= 60 || ratio < 9000) {
            // WARNING: Log only
            actionHistory.push(EmergencyAction({
                timestamp: block.timestamp,
                riskScore: riskScore,
                ratio: ratio,
                action: "WARNING_LOGGED"
            }));
        }
    }
    
    /**
     * @notice Resume protocol (owner only, after investigation)
     */
    function resumeProtocol() external onlyOwner {
        require(isPaused, "Not paused");
        
        isPaused = false;
        
        emit ProtocolResumed(block.timestamp, msg.sender);
    }
    
    function setOracle(address _oracle) external onlyOwner {
        oracle = _oracle;
    }
    
    function getActionHistory(uint256 count) external view returns (EmergencyAction[] memory) {
        uint256 start = actionHistory.length > count ? actionHistory.length - count : 0;
        uint256 size = actionHistory.length - start;
        
        EmergencyAction[] memory recent = new EmergencyAction[](size);
        for (uint256 i = 0; i < size; i++) {
            recent[i] = actionHistory[start + i];
        }
        return recent;
    }
    
    function _pauseProtocol(uint256 riskScore, uint256 ratio) internal {
        if (!isPaused) {
            isPaused = true;
            lastPauseTime = block.timestamp;
            pauseCount++;
            
            emit ProtocolPaused(block.timestamp, riskScore, ratio);
            emit EmergencyExecuted("PROTOCOL_PAUSED", riskScore);
        }
    }
}