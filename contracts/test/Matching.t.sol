// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/MockERC20.sol";
import "../src/AgentRegistry.sol";
import "../src/CommitRevealCLOB.sol";

contract MatchingTest is Test {

    MockERC20        tokenA;
    MockERC20        tokenB;
    AgentRegistry    registry;
    CommitRevealCLOB clob;

    address deployer = address(0x1);
    address agent1   = address(0x2);
    address agent2   = address(0x3);
    address agent3   = address(0x4);

    uint256 constant MINT_AMOUNT = 100_000 * 1e18;

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
        tokenA.mint(agent3, MINT_AMOUNT);
        tokenB.mint(agent1, MINT_AMOUNT);
        tokenB.mint(agent2, MINT_AMOUNT);
        tokenB.mint(agent3, MINT_AMOUNT);

        vm.stopPrank();

        address[3] memory agents = [agent1, agent2, agent3];
        for (uint i = 0; i < 3; i++) {
            
            vm.deal(agents[i], 1 ether);
            vm.prank(agents[i]);
            registry.registerAgent{value: 0.01 ether}();

            vm.prank(agents[i]);
            tokenA.approve(address(clob), type(uint256).max);

            vm.prank(agents[i]);
            tokenB.approve(address(clob), type(uint256).max);
        }
    }

    function _commit(
        address agent,
        uint256 price,
        uint256 amount,
        CommitRevealCLOB.Direction dir,
        bytes32 salt
    ) internal returns (uint256 orderId) {
        bytes32 commitment = keccak256(abi.encodePacked(price, amount, dir, salt));
        vm.prank(agent);
        orderId = clob.commitOrder(commitment);
    }

    function _reveal(
        address agent,
        uint256 orderId,
        uint256 price,
        uint256 amount,
        CommitRevealCLOB.Direction dir,
        bytes32 salt
    ) internal {
        vm.prank(agent);
        clob.revealOrder(orderId, price, amount, dir, salt);
    }

    // ─── Tests of Match ────────────────────────────────────────────────────────

    function test_match_crossedSpreadExecutes() public {
        uint256 bidPrice = 3001 * 1e18;
        uint256 askPrice = 2999 * 1e18; // ask < bid → precios cruzados → match
        uint256 amount   = 1e18;
        bytes32 salt1    = keccak256("s1");
        bytes32 salt2    = keccak256("s2");

        uint256 bidId = _commit(agent1, bidPrice, amount, CommitRevealCLOB.Direction.BID, salt1);
        uint256 askId = _commit(agent2, askPrice, amount, CommitRevealCLOB.Direction.ASK, salt2);

        vm.roll(block.number + 1);

        _reveal(agent1, bidId, bidPrice, amount, CommitRevealCLOB.Direction.BID, salt1);
        _reveal(agent2, askId, askPrice, amount, CommitRevealCLOB.Direction.ASK, salt2);

        // Ambas órdenes deben estar MATCHED
        assertEq(uint8(clob.getOrder(bidId).status), uint8(CommitRevealCLOB.OrderStatus.MATCHED));
        assertEq(uint8(clob.getOrder(askId).status), uint8(CommitRevealCLOB.OrderStatus.MATCHED));
    }

    function test_match_noMatchWhenSpreadOpen() public {
        uint256 bidPrice = 2990 * 1e18;
        uint256 askPrice = 3010 * 1e18; // bid < ask → no cruce → no match
        uint256 amount   = 1e18;

        uint256 bidId = _commit(agent1, bidPrice, amount, CommitRevealCLOB.Direction.BID, keccak256("s1"));
        uint256 askId = _commit(agent2, askPrice, amount, CommitRevealCLOB.Direction.ASK, keccak256("s2"));

        vm.roll(block.number + 1);

        _reveal(agent1, bidId, bidPrice, amount, CommitRevealCLOB.Direction.BID, keccak256("s1"));
        _reveal(agent2, askId, askPrice, amount, CommitRevealCLOB.Direction.ASK, keccak256("s2"));

        // Both orders must remain REVEALED — no match
        assertEq(uint8(clob.getOrder(bidId).status), uint8(CommitRevealCLOB.OrderStatus.REVEALED));
        assertEq(uint8(clob.getOrder(askId).status), uint8(CommitRevealCLOB.OrderStatus.REVEALED));

        // Verify that the bid and ask arrays each contain exactly one element
        assertEq(clob.getOpenBids().length, 1);
        assertEq(clob.getOpenAsks().length, 1);
    }

    function test_match_executionPriceIsMidpoint() public {
        uint256 bidPrice = 3002 * 1e18;
        uint256 askPrice = 2998 * 1e18;
        uint256 amount   = 1e18;
        bytes32 salt1    = keccak256("s1");
        bytes32 salt2    = keccak256("s2");

        uint256 agent2TokenBBefore = tokenB.balanceOf(agent2);
        uint256 agent1TokenABefore = tokenA.balanceOf(agent1);

        uint256 bidId = _commit(agent1, bidPrice, amount, CommitRevealCLOB.Direction.BID, salt1);
        uint256 askId = _commit(agent2, askPrice, amount, CommitRevealCLOB.Direction.ASK, salt2);

        vm.roll(block.number + 1);

        _reveal(agent1, bidId, bidPrice, amount, CommitRevealCLOB.Direction.BID, salt1);
        _reveal(agent2, askId, askPrice, amount, CommitRevealCLOB.Direction.ASK, salt2);

        // Execution price = midpoint = (3002 + 2998) / 2 = 3000
        uint256 execPrice = 3000 * 1e18;
        uint256 totalCost = (execPrice * amount) / 1e18; // 3000e18

        // Fee in tokenB = totalCost * 10 / 10000 = 3e18
        uint256 feeInTokenB = (totalCost * 10) / 10000;

        // agent2 debe recibir totalCost - feeInTokenB en tokenB
        assertApproxEqAbs(
            tokenB.balanceOf(agent2),
            agent2TokenBBefore + totalCost - feeInTokenB,
            1e15,
            "agent2 tokenB incorrecto"
        );

        // Fee en tokenA = amount * 10 / 10000
        uint256 feeInTokenA = (amount * 10) / 10000;

        // agent1 must receive amount - feeInTokenA in tokenA
        assertApproxEqAbs(
            tokenA.balanceOf(agent1),
            agent1TokenABefore + amount - feeInTokenA,
            1e15,
            "agent1 tokenA incorrecto"
        );
    }

    function test_match_bestBidSelectedAmongMultiple() public {
        uint256 amount = 1e18;

        // 3 bids with distinct prices
        uint256 bidId1 = _commit(agent1, 2990 * 1e18, amount, CommitRevealCLOB.Direction.BID, keccak256("b1"));
        uint256 bidId2 = _commit(agent2, 3005 * 1e18, amount, CommitRevealCLOB.Direction.BID, keccak256("b2")); // mejor
        uint256 bidId3 = _commit(agent3, 2995 * 1e18, amount, CommitRevealCLOB.Direction.BID, keccak256("b3"));

        vm.roll(block.number + 1);

        _reveal(agent1, bidId1, 2990 * 1e18, amount, CommitRevealCLOB.Direction.BID, keccak256("b1"));
        _reveal(agent2, bidId2, 3005 * 1e18, amount, CommitRevealCLOB.Direction.BID, keccak256("b2"));
        _reveal(agent3, bidId3, 2995 * 1e18, amount, CommitRevealCLOB.Direction.BID, keccak256("b3"));

        // 1 ask that crosses with the best bid
        uint256 askId = _commit(agent2, 3000 * 1e18, amount, CommitRevealCLOB.Direction.ASK, keccak256("a1"));
        vm.roll(block.number + 1);
        _reveal(agent2, askId, 3000 * 1e18, amount, CommitRevealCLOB.Direction.ASK, keccak256("a1"));

        // bidId2 (highest price 3005) must have matched
        assertEq(uint8(clob.getOrder(bidId2).status), uint8(CommitRevealCLOB.OrderStatus.MATCHED));

        // The other bids must remain REVEALED
        assertEq(uint8(clob.getOrder(bidId1).status), uint8(CommitRevealCLOB.OrderStatus.REVEALED));
        assertEq(uint8(clob.getOrder(bidId3).status), uint8(CommitRevealCLOB.OrderStatus.REVEALED));
    }

    function test_match_bestAskSelectedAmongMultiple() public {
        uint256 amount = 1e18;

        // 3 asks with distinct prices
        uint256 askId1 = _commit(agent1, 3010 * 1e18, amount, CommitRevealCLOB.Direction.ASK, keccak256("a1"));
        uint256 askId2 = _commit(agent2, 2995 * 1e18, amount, CommitRevealCLOB.Direction.ASK, keccak256("a2")); // mejor
        uint256 askId3 = _commit(agent3, 3005 * 1e18, amount, CommitRevealCLOB.Direction.ASK, keccak256("a3"));

        vm.roll(block.number + 1);

        _reveal(agent1, askId1, 3010 * 1e18, amount, CommitRevealCLOB.Direction.ASK, keccak256("a1"));
        _reveal(agent2, askId2, 2995 * 1e18, amount, CommitRevealCLOB.Direction.ASK, keccak256("a2"));
        _reveal(agent3, askId3, 3005 * 1e18, amount, CommitRevealCLOB.Direction.ASK, keccak256("a3"));

        // 1 bid that crosses with the best ask
        uint256 bidId = _commit(agent1, 3000 * 1e18, amount, CommitRevealCLOB.Direction.BID, keccak256("b1"));
        vm.roll(block.number + 1);
        _reveal(agent1, bidId, 3000 * 1e18, amount, CommitRevealCLOB.Direction.BID, keccak256("b1"));

        // askId2 (lowest price 2995) must have matched
        assertEq(uint8(clob.getOrder(askId2).status), uint8(CommitRevealCLOB.OrderStatus.MATCHED));

        // The other asks must remain REVEALED
        assertEq(uint8(clob.getOrder(askId1).status), uint8(CommitRevealCLOB.OrderStatus.REVEALED));
        assertEq(uint8(clob.getOrder(askId3).status), uint8(CommitRevealCLOB.OrderStatus.REVEALED));
    }

    function test_match_removesMatchedOrdersFromArrays() public {
        uint256 amount = 1e18;
        bytes32 salt1  = keccak256("s1");
        bytes32 salt2  = keccak256("s2");

        uint256 bidId = _commit(agent1, 3001 * 1e18, amount, CommitRevealCLOB.Direction.BID, salt1);
        uint256 askId = _commit(agent2, 2999 * 1e18, amount, CommitRevealCLOB.Direction.ASK, salt2);

        vm.roll(block.number + 1);

        _reveal(agent1, bidId, 3001 * 1e18, amount, CommitRevealCLOB.Direction.BID, salt1);
        _reveal(agent2, askId, 2999 * 1e18, amount, CommitRevealCLOB.Direction.ASK, salt2);

        // Arrays must be empty after the match
        assertEq(clob.getOpenBids().length, 0, "openBids debe estar vacio");
        assertEq(clob.getOpenAsks().length, 0, "openAsks debe estar vacio");
    }

    function test_match_feesGoToFeeRecipient() public {
        uint256 amount = 1e18;
        bytes32 salt1  = keccak256("s1");
        bytes32 salt2  = keccak256("s2");

        uint256 deployerTokenABefore = tokenA.balanceOf(deployer);
        uint256 deployerTokenBBefore = tokenB.balanceOf(deployer);

        uint256 bidId = _commit(agent1, 3001 * 1e18, amount, CommitRevealCLOB.Direction.BID, salt1);
        uint256 askId = _commit(agent2, 2999 * 1e18, amount, CommitRevealCLOB.Direction.ASK, salt2);

        vm.roll(block.number + 1);

        _reveal(agent1, bidId, 3001 * 1e18, amount, CommitRevealCLOB.Direction.BID, salt1);
        _reveal(agent2, askId, 2999 * 1e18, amount, CommitRevealCLOB.Direction.ASK, salt2);

        // deployer (feeRecipient) must have received fees in both tokens
        assertGt(tokenA.balanceOf(deployer), deployerTokenABefore, "No recibio fee en tokenA");
        assertGt(tokenB.balanceOf(deployer), deployerTokenBBefore, "No recibio fee en tokenB");
    }
}