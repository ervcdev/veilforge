// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./CommitRevealCLOB.sol";

/// @notice Adapter that receives callbacks from Somnia Reactivity
/// and automatically triggers matching.
/// devMode = true during the hackathon in case the precompile
/// is not active on Shannon Testnet.
contract ReactivityAdapter {

    CommitRevealCLOB public clob;
    address          public owner;
    address          public reactivityPrecompile;
    bool             public devMode;

    event ReactivityTriggered(bytes32 indexed eventId, uint256 blockNumber);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyReactivity() {
        require(
            devMode || msg.sender == reactivityPrecompile,
            "Only Somnia Reactivity"
        );
        _;
    }

    constructor(address _clob, address _reactivityPrecompile) {
        clob                 = CommitRevealCLOB(_clob);
        owner                = msg.sender;
        reactivityPrecompile = _reactivityPrecompile;
        devMode              = true; // activo por default para el hackathon
    }

    /// @notice Callback called by Somnia Reactivity when
    /// the OrderRevealed event is emitted in CommitRevealCLOB
    function handleOrderRevealed(bytes calldata eventData) external onlyReactivity {
        (uint256 orderId,,,,,) = abi.decode(
            eventData,
            (uint256, address, uint256, uint256, uint8, uint256)
        );
        emit ReactivityTriggered(bytes32(orderId), block.number);
        clob.matchOrders();
    }

    /// @notice Fallback for when Reactivity passes additional data
    function handleEvent(bytes calldata) external onlyReactivity {
        clob.matchOrders();
    }

    // ─── Admin ─────────────────────────────────────────────────────────────────

    function setDevMode(bool _devMode) external onlyOwner {
        devMode = _devMode;
    }

    function setReactivityPrecompile(address _addr) external onlyOwner {
        reactivityPrecompile = _addr;
    }

    /// @notice Info to register the subscription via Somnia Reactivity SDK
    function getSubscriptionInfo() external view returns (
        address watchedContract,
        bytes32 watchedEventSig,
        address callbackContract,
        bytes4  callbackSelector
    ) {
        return (
            address(clob),
            keccak256("OrderRevealed(uint256,address,uint256,uint256,uint8,uint256)"),
            address(this),
            this.handleOrderRevealed.selector
        );
    }
}