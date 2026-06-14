// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/MockERC20.sol";
import "../src/AgentRegistry.sol";
import "../src/CommitRevealCLOB.sol";

contract CommitRevealTest is Test {

    MockERC20        tokenA;
    MockERC20        tokenB;
    AgentRegistry    registry;
    CommitRevealCLOB clob;

    address deployer = address(0x1);
    address agent1   = address(0x2);
    address agent2   = address(0x3);

    uint256 constant MINT_AMOUNT = 100_000 * 1e18;
    uint256 constant PRICE       = 3000 * 1e18;
    uint256 constant AMOUNT      = 1e18;

    function setUp() public {
        vm.startPrank(deployer);

        tokenA   = new MockERC20("WETH Mock", "WETH", 18);
        tokenB   = new MockERC20("USDC Mock", "USDC", 18);
        registry = new AgentRegistry();
        clob     = new CommitRevealCLOB(
            address(registry),
            address(tokenA),
            address(tokenB)
        );

        registry.setCLOBContract(address(clob));
        clob.setFeeRecipient(deployer);
        clob.setKeeper(deployer);

        tokenA.mint(agent1, MINT_AMOUNT);
        tokenA.mint(agent2, MINT_AMOUNT);
        tokenB.mint(agent1, MINT_AMOUNT);
        tokenB.mint(agent2, MINT_AMOUNT);

        vm.stopPrank();

        // Register agents with collateral
        vm.deal(agent1, 1 ether);
        vm.prank(agent1);
        registry.registerAgent{value: 0.01 ether}();

        vm.deal(agent2, 1 ether);
        vm.prank(agent2);
        registry.registerAgent{value: 0.01 ether}();

        // Approve tokens to the CLOB
        vm.prank(agent1);
        tokenA.approve(address(clob), type(uint256).max);
        vm.prank(agent1);
        tokenB.approve(address(clob), type(uint256).max);

        vm.prank(agent2);
        tokenA.approve(address(clob), type(uint256).max);
        vm.prank(agent2);
        tokenB.approve(address(clob), type(uint256).max);
    }

    // ─── Helpers ───────────────────────────────────────────────────────────────

    function _makeCommitment(
        uint256 price,
        uint256 amount,
        CommitRevealCLOB.Direction direction,
        bytes32 salt
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(price, amount, direction, salt));
    }

    function _commitAndReveal(
        address agent,
        uint256 price,
        uint256 amount,
        CommitRevealCLOB.Direction direction,
        bytes32 salt
    ) internal returns (uint256 orderId) {
        bytes32 commitment = _makeCommitment(price, amount, direction, salt);

        vm.prank(agent);
        orderId = clob.commitOrder(commitment);

        vm.roll(block.number + 1);

        vm.prank(agent);
        clob.revealOrder(orderId, price, amount, direction, salt);
    }

    // ─── Tests de Commit ───────────────────────────────────────────────────────

    function test_commitOrder_storesHash() public {
        bytes32 salt       = keccak256("salt1");
        bytes32 commitment = _makeCommitment(PRICE, AMOUNT, CommitRevealCLOB.Direction.BID, salt);

        vm.prank(agent1);
        uint256 orderId = clob.commitOrder(commitment);

        CommitRevealCLOB.Order memory order = clob.getOrder(orderId);

        assertEq(order.agent,                agent1,                           "Agent incorrecto");
        assertEq(order.commitment,           commitment,                       "Commitment incorrecto");
        assertEq(uint8(order.status),        uint8(CommitRevealCLOB.OrderStatus.COMMITTED), "Status incorrecto");
        assertEq(order.commitBlock,          block.number,                     "Block incorrecto");
        assertEq(order.price,                0,                                "Price debe ser 0 en commit");
        assertEq(order.amount,               0,                                "Amount debe ser 0 en commit");
    }

    function test_commitOrder_incrementsOrderCount() public {
        assertEq(clob.orderCount(), 0);

        bytes32 salt = keccak256("salt");
        vm.prank(agent1);
        clob.commitOrder(_makeCommitment(PRICE, AMOUNT, CommitRevealCLOB.Direction.BID, salt));

        assertEq(clob.orderCount(), 1);
    }

    function test_commitOrder_requiresRegisteredAgent() public {
        address unregistered = address(0x99);
        bytes32 salt         = keccak256("salt");

        vm.prank(unregistered);
        vm.expectRevert("Agent not registered");
        clob.commitOrder(_makeCommitment(PRICE, AMOUNT, CommitRevealCLOB.Direction.BID, salt));
    }

    function test_commitOrder_incrementsActiveOrders() public {
        assertEq(registry.activeOrders(agent1), 0);

        bytes32 salt = keccak256("salt");
        vm.prank(agent1);
        clob.commitOrder(_makeCommitment(PRICE, AMOUNT, CommitRevealCLOB.Direction.BID, salt));

        assertEq(registry.activeOrders(agent1), 1);
    }

    // ─── Tests of Reveal ───────────────────────────────────────────────────────

    function test_revealOrder_succeedsWithCorrectParams() public {
        bytes32 salt       = keccak256("salt1");
        bytes32 commitment = _makeCommitment(PRICE, AMOUNT, CommitRevealCLOB.Direction.BID, salt);

        vm.prank(agent1);
        uint256 orderId = clob.commitOrder(commitment);

        vm.roll(block.number + 1);

        vm.prank(agent1);
        clob.revealOrder(orderId, PRICE, AMOUNT, CommitRevealCLOB.Direction.BID, salt);

        CommitRevealCLOB.Order memory order = clob.getOrder(orderId);
        assertEq(uint8(order.status), uint8(CommitRevealCLOB.OrderStatus.REVEALED));
        assertEq(order.price,  PRICE);
        assertEq(order.amount, AMOUNT);
    }

    function test_revealOrder_failsWithWrongSalt() public {
        bytes32 salt       = keccak256("correct_salt");
        bytes32 wrongSalt  = keccak256("wrong_salt");
        bytes32 commitment = _makeCommitment(PRICE, AMOUNT, CommitRevealCLOB.Direction.BID, salt);

        vm.prank(agent1);
        uint256 orderId = clob.commitOrder(commitment);

        vm.roll(block.number + 1);

        vm.prank(agent1);
        vm.expectRevert("Commitment mismatch");
        clob.revealOrder(orderId, PRICE, AMOUNT, CommitRevealCLOB.Direction.BID, wrongSalt);
    }

    function test_revealOrder_failsWithWrongPrice() public {
        bytes32 salt       = keccak256("salt");
        bytes32 commitment = _makeCommitment(PRICE, AMOUNT, CommitRevealCLOB.Direction.BID, salt);

        vm.prank(agent1);
        uint256 orderId = clob.commitOrder(commitment);

        vm.roll(block.number + 1);

        vm.prank(agent1);
        vm.expectRevert("Commitment mismatch");
        clob.revealOrder(orderId, PRICE + 1, AMOUNT, CommitRevealCLOB.Direction.BID, salt);
    }

    function test_revealOrder_failsTooEarly() public {
        bytes32 salt       = keccak256("salt");
        bytes32 commitment = _makeCommitment(PRICE, AMOUNT, CommitRevealCLOB.Direction.BID, salt);

        vm.prank(agent1);
        uint256 orderId = clob.commitOrder(commitment);

        // DO NOT advance block — reveal within the same block
        vm.prank(agent1);
        vm.expectRevert("Too early to reveal");
        clob.revealOrder(orderId, PRICE, AMOUNT, CommitRevealCLOB.Direction.BID, salt);
    }

    function test_revealOrder_failsAfterWindowExpired() public {
        bytes32 salt       = keccak256("salt");
        bytes32 commitment = _makeCommitment(PRICE, AMOUNT, CommitRevealCLOB.Direction.BID, salt);

        vm.prank(agent1);
        uint256 orderId = clob.commitOrder(commitment);

        // Avanzar más allá del REVEAL_WINDOW (5 bloques)
        vm.roll(block.number + 51);

        vm.prank(agent1);
        vm.expectRevert("Reveal window expired");
        clob.revealOrder(orderId, PRICE, AMOUNT, CommitRevealCLOB.Direction.BID, salt);
    }

    function test_revealOrder_failsIfNotOwner() public {
        bytes32 salt       = keccak256("salt");
        bytes32 commitment = _makeCommitment(PRICE, AMOUNT, CommitRevealCLOB.Direction.BID, salt);

        vm.prank(agent1);
        uint256 orderId = clob.commitOrder(commitment);

        vm.roll(block.number + 1);

        // agent2 attempts to reveal agent1's order
        vm.prank(agent2);
        vm.expectRevert("Not your order");
        clob.revealOrder(orderId, PRICE, AMOUNT, CommitRevealCLOB.Direction.BID, salt);
    }

    function test_revealOrder_decrementsActiveOrders() public {
        bytes32 salt       = keccak256("salt");
        bytes32 commitment = _makeCommitment(PRICE, AMOUNT, CommitRevealCLOB.Direction.BID, salt);

        vm.prank(agent1);
        uint256 orderId = clob.commitOrder(commitment);
        assertEq(registry.activeOrders(agent1), 1);

        vm.roll(block.number + 1);

        vm.prank(agent1);
        clob.revealOrder(orderId, PRICE, AMOUNT, CommitRevealCLOB.Direction.BID, salt);
        assertEq(registry.activeOrders(agent1), 0);
    }

    function test_revealOrder_addsToBidArray() public {
        bytes32 salt = keccak256("salt");
        _commitAndReveal(agent1, PRICE, AMOUNT, CommitRevealCLOB.Direction.BID, salt);

        uint256[] memory bids = clob.getOpenBids();
        assertEq(bids.length, 1);
    }

    function test_revealOrder_addsToAskArray() public {
        bytes32 salt = keccak256("salt");
        _commitAndReveal(agent1, PRICE, AMOUNT, CommitRevealCLOB.Direction.ASK, salt);

        uint256[] memory asks = clob.getOpenAsks();
        assertEq(asks.length, 1);
    }

    // ─── Tests of Expire ───────────────────────────────────────────────────────

    function test_expireOrder_setsStatusExpired() public {
        bytes32 salt       = keccak256("salt");
        bytes32 commitment = _makeCommitment(PRICE, AMOUNT, CommitRevealCLOB.Direction.BID, salt);

        vm.prank(agent1);
        uint256 orderId = clob.commitOrder(commitment);

        // Advance beyond the reveal window + grace period
        vm.roll(block.number + 52);

        // deployer is the keeper
        vm.prank(deployer); 
        clob.expireOrder(orderId);

        CommitRevealCLOB.Order memory order = clob.getOrder(orderId);
        assertEq(uint8(order.status), uint8(CommitRevealCLOB.OrderStatus.EXPIRED));
    }

    function test_expireOrder_failsIfWindowNotClosed() public {
        bytes32 salt = keccak256("salt");
        vm.prank(agent1);
        uint256 orderId = clob.commitOrder(
            _makeCommitment(PRICE, AMOUNT, CommitRevealCLOB.Direction.BID, salt)
        );

        // Advance only 3 blocks — window not closed
        vm.roll(block.number + 3);

        vm.expectRevert("Grace period still active");
        clob.expireOrder(orderId);
    }
}