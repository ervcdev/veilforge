// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract AgentRegistry is Ownable, ReentrancyGuard {

    // ─── Structs ───────────────────────────────────────────────────────────────

    struct Agent {
        // Slot 0 — packed storage [FIX H-1]
        uint64  registeredAt;    // timestamp — uint64 supports up to year 2554
        uint64  slashCount;      // max 1.8×10^19 slashes
        uint64  ordersExecuted;  // max 1.8×10^19 órdenes
        bool    registered;      // 1 byte

        // Slot 1
        uint256 collateral;

        // Slot 2
        uint256 totalVolume;

        // Slot 3
        uint256 feesEarned;
    }

    // ─── State ─────────────────────────────────────────────────────────────────

    mapping(address => Agent)   public agents;
    mapping(address => uint256) public activeOrders; // [FIX H-2]
    address[]                   public agentList;

    uint256 public constant MIN_COLLATERAL = 0.01 ether;
    uint256 public constant SLASH_AMOUNT   = 0.001 ether;

    address public clobContract;

    // ─── Events ────────────────────────────────────────────────────────────────

    event AgentRegistered(address indexed agent, uint256 collateral, uint256 timestamp);
    event CollateralDeposited(address indexed agent, uint256 amount);
    event CollateralWithdrawn(address indexed agent, uint256 amount);
    event AgentDeregistered(address indexed agent);

    event AgentSlashed(
        address indexed agent,
        uint256 amount,
        string  reason
    );

    event StatsUpdated(address indexed agent, uint256 ordersExecuted, uint256 feesEarned);

    // ─── Modifiers ─────────────────────────────────────────────────────────────

    modifier onlyRegistered() {
        require(agents[msg.sender].registered, "Agent not registered");
        _;
    }

    modifier onlyCLOB() {
        require(msg.sender == clobContract, "Only CLOB can call this");
        _;
    }

    // ─── Constructor ───────────────────────────────────────────────────────────

    constructor() Ownable(msg.sender) {}

    // ─── Setup ─────────────────────────────────────────────────────────────────

    function setCLOBContract(address _clob) external onlyOwner {
        clobContract = _clob;
    }

    // ─── Agent Management ──────────────────────────────────────────────────────

    function registerAgent() external payable {
        require(!agents[msg.sender].registered, "Already registered");
        require(msg.value >= MIN_COLLATERAL,     "Insufficient collateral");

        agents[msg.sender] = Agent({
            registeredAt:   uint64(block.timestamp),
            slashCount:     0,
            ordersExecuted: 0,
            registered:     true,
            collateral:     msg.value,
            totalVolume:    0,
            feesEarned:     0
        });

        agentList.push(msg.sender);
        emit AgentRegistered(msg.sender, msg.value, block.timestamp);
    }

    function depositCollateral() external payable onlyRegistered {
        agents[msg.sender].collateral += msg.value;
        emit CollateralDeposited(msg.sender, msg.value);
    }

    /// @notice Withdraw collateral
    /// [FIX V2] Allows full withdrawal (system exit) or maintaining MIN_COLLATERAL.
    /// The previous bug locked agents who deposited exactly MIN_COLLATERAL.
    function withdrawCollateral(uint256 amount) external  onlyRegistered {
        require(activeOrders[msg.sender] == 0,           "Has active orders pending");
        require(agents[msg.sender].collateral >= amount,  "Insufficient collateral");

        uint256 remaining = agents[msg.sender].collateral - amount;

        // [FIX V2] Allow full withdrawal (remaining == 0) or maintaining the minimum required
        require(
            remaining == 0 || remaining >= MIN_COLLATERAL,
            "Leave 0 (full exit) or keep at least MIN_COLLATERAL"
        );

       // If total withdrawal -> trigger automatic unregistration
        if (remaining == 0) {
            agents[msg.sender].registered = false;
            emit AgentDeregistered(msg.sender);
        }

        agents[msg.sender].collateral -= amount;
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "Transfer failed");
        emit CollateralWithdrawn(msg.sender, amount);
    }

    // ─── Called by CLOB — Active Orders Tracking [FIX H-2] ────────────────────

    function incrementActiveOrders(address agent) external onlyCLOB {
        unchecked { activeOrders[agent]++; }
    }

    function decrementActiveOrders(address agent) external onlyCLOB {
        if (activeOrders[agent] > 0) {
            unchecked { activeOrders[agent]--; }
        }
    }

    // ─── Called by CLOB — Slash & Stats ────────────────────────────────────────

    /// @notice Slash an agent for failing to reveal their order on time
    /// CRITICAL: the CLOB calls decrementActiveOrders BEFORE calling slashAgent
    function slashAgent(address agent, string calldata reason) external onlyCLOB {
        require(agents[agent].registered, "Agent not registered");

        uint256 slash = SLASH_AMOUNT;
        if (agents[agent].collateral < slash) {
            slash = agents[agent].collateral;
        }

        agents[agent].collateral -= slash;
        unchecked { agents[agent].slashCount += 1; }

        emit AgentSlashed(agent, slash, reason);
    }

    /// @notice Update stats after a successful match
    function updateStats(
        address agent,
        uint256 volume,
        uint256 fee
    ) external onlyCLOB {
        unchecked { agents[agent].ordersExecuted += 1; }
        agents[agent].totalVolume += volume;
        agents[agent].feesEarned  += fee;
        emit StatsUpdated(agent, agents[agent].ordersExecuted, agents[agent].feesEarned);
    }

    // ─── Views ─────────────────────────────────────────────────────────────────

    function getAgent(address agent) external view returns (Agent memory) {
        return agents[agent];
    }

    function isRegistered(address agent) external view returns (bool) {
        return agents[agent].registered;
    }

    function getAgentCount() external view returns (uint256) {
        return agentList.length;
    }

    function getAllAgents() external view returns (address[] memory) {
        return agentList;
    }
}