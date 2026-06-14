// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/MockERC20.sol";
import "../src/AgentRegistry.sol";
import "../src/CommitRevealCLOB.sol";

contract AuditFixesTest is Test {
    MockERC20 tokenA;
    MockERC20 tokenB;
    AgentRegistry registry;
    CommitRevealCLOB clob;

    address deployer = address(0x1);
    address agent1 = address(0x2);
    address agent2 = address(0x3);
    address attacker = address(0x4);

    uint256 constant MINT_AMOUNT = 100_000 * 1e18;

    function setUp() public {
        vm.startPrank(deployer);

        tokenA = new MockERC20("WETH Mock", "WETH", 18);
        tokenB = new MockERC20("USDC Mock", "USDC", 18);
        registry = new AgentRegistry();
        clob = new CommitRevealCLOB(
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

        vm.deal(agent1, 1 ether);
        vm.prank(agent1);
        registry.registerAgent{value: 0.01 ether}();

        vm.deal(agent2, 1 ether);
        vm.prank(agent2);
        registry.registerAgent{value: 0.01 ether}();

        vm.prank(agent1);
        tokenA.approve(address(clob), type(uint256).max);
        vm.prank(agent1);
        tokenB.approve(address(clob), type(uint256).max);

        vm.prank(agent2);
        tokenA.approve(address(clob), type(uint256).max);
        vm.prank(agent2);
        tokenB.approve(address(clob), type(uint256).max);
    }

// ─── [FIX C-1 + GAP-4] Fees are sent to the feeRecipient in both tokens ───
    function test_feesReachRecipientInBothTokens() public {
        uint256 price = 3000 * 1e18;
        uint256 amount = 1e18;
        bytes32 salt1 = keccak256("salt1");
        bytes32 salt2 = keccak256("salt2");

        bytes32 c1 = keccak256(
            abi.encodePacked(
                price,
                amount,
                CommitRevealCLOB.Direction.BID,
                salt1
            )
        );
        bytes32 c2 = keccak256(
            abi.encodePacked(
                price,
                amount,
                CommitRevealCLOB.Direction.ASK,
                salt2
            )
        );

        vm.prank(agent1);
        clob.commitOrder(c1);
        vm.prank(agent2);
        clob.commitOrder(c2);

        vm.roll(block.number + 1);

        uint256 deployerTokenABefore = tokenA.balanceOf(deployer);
        uint256 deployerTokenBBefore = tokenB.balanceOf(deployer);

        vm.prank(agent1);
        clob.revealOrder(
            1,
            price,
            amount,
            CommitRevealCLOB.Direction.BID,
            salt1
        );

        vm.prank(agent2);
        clob.revealOrder(
            2,
            price,
            amount,
            CommitRevealCLOB.Direction.ASK,
            salt2
        );

        assertGt(
            tokenA.balanceOf(deployer),
            deployerTokenABefore,
            "[C-1] feeRecipient debe recibir fee en tokenA"
        );
        assertGt(
            tokenB.balanceOf(deployer),
            deployerTokenBBefore,
            "[C-1] feeRecipient debe recibir fee en tokenB"
        );
    }

  // ─── [FIX C-3] expireOrder without a keeper does NOT execute a slash ───────

    function test_expireOrderNoSlashWithoutKeeper() public {
        bytes32 salt = keccak256("salt");
        bytes32 commitment = keccak256(
            abi.encodePacked(
                uint256(3000 * 1e18),
                uint256(1e18),
                CommitRevealCLOB.Direction.BID,
                salt
            )
        );

        vm.prank(agent1);
        clob.commitOrder(commitment);

        // Advance beyond the reveal window + grace period
        vm.roll(block.number + 60);

        AgentRegistry.Agent memory agentBefore = registry.getAgent(agent1);
        uint64 slashCountBefore = agentBefore.slashCount;

        AgentRegistry.Agent memory agentAfter = registry.getAgent(agent1);
        assertEq(
            agentAfter.slashCount,
            slashCountBefore,
            "[C-3] Attacker must not be able to slash the agent"
        );

        // Attacker calls expireOrder — should not slash
        vm.prank(attacker);
        clob.expireOrder(1);

        // slashCount should not have changed
        assertEq(
            registry.getAgent(agent1).slashCount,
            slashCountBefore,
            "[C-3] Atacante no debe poder slash al agente"
        );

        // The order must be EXPIRED
        assertEq(
            uint8(clob.getOrder(1).status),
            uint8(CommitRevealCLOB.OrderStatus.EXPIRED),
            "[C-3] Orden debe estar EXPIRED"
        );
    }

    // ─── [FIX H-2] activeOrders is correctly decremented ──────────────────────────
    function test_activeOrdersDecrementOnReveal() public {
        uint256 price = 3000 * 1e18;
        uint256 amount = 1e18;
        bytes32 salt = keccak256("salt");
        bytes32 commitment = keccak256(
            abi.encodePacked(
                price,
                amount,
                CommitRevealCLOB.Direction.BID,
                salt
            )
        );

        assertEq(
            registry.activeOrders(agent1),
            0,
            "activeOrders debe ser 0 al inicio"
        );

        vm.prank(agent1);
        clob.commitOrder(commitment);
        assertEq(
            registry.activeOrders(agent1),
            1,
            "activeOrders debe ser 1 despues del commit"
        );

        vm.roll(block.number + 1);

        vm.prank(agent1);
        clob.revealOrder(
            1,
            price,
            amount,
            CommitRevealCLOB.Direction.BID,
            salt
        );
        assertEq(
            registry.activeOrders(agent1),
            0,
            "activeOrders debe ser 0 despues del reveal"
        );

        // Verify that collateral can be withdrawn (activeOrders == 0)
        AgentRegistry.Agent memory agentData = registry.getAgent(agent1);
        uint256 colateral = agentData.collateral;
        uint256 retiro = colateral - registry.MIN_COLLATERAL();
        if (retiro > 0) {
            vm.prank(agent1);
            registry.withdrawCollateral(retiro); // no debe revertir
        }
    }

    // ─── [FIX GAP-4] Fees are calculated in the correct units ───────────────────

    function test_feeUnitsAreCorrect() public {
        uint256 price = 3000 * 1e18;
        uint256 amount = 1e18;
        bytes32 salt1 = keccak256("s1");
        bytes32 salt2 = keccak256("s2");

        bytes32 c1 = keccak256(
            abi.encodePacked(
                price,
                amount,
                CommitRevealCLOB.Direction.BID,
                salt1
            )
        );
        bytes32 c2 = keccak256(
            abi.encodePacked(
                price,
                amount,
                CommitRevealCLOB.Direction.ASK,
                salt2
            )
        );

        vm.prank(agent1);
        clob.commitOrder(c1);
        vm.prank(agent2);
        clob.commitOrder(c2);

        vm.roll(block.number + 1);

        uint256 agent2TokenBBefore = tokenB.balanceOf(agent2);
        uint256 agent1TokenABefore = tokenA.balanceOf(agent1);

        vm.prank(agent1);
        clob.revealOrder(
            1,
            price,
            amount,
            CommitRevealCLOB.Direction.BID,
            salt1
        );
        vm.prank(agent2);
        clob.revealOrder(
            2,
            price,
            amount,
            CommitRevealCLOB.Direction.ASK,
            salt2
        );

        // totalCost = 3000e18, feeInTokenB = 3000e18 * 10 / 10000 = 3e18
        uint256 totalCost = (price * amount) / 1e18;
        uint256 feeInTokenB = (totalCost * 10) / 10000;

        // agent2 must receive totalCost - feeInTokenB in tokenB
        assertApproxEqAbs(
            tokenB.balanceOf(agent2),
            agent2TokenBBefore + totalCost - feeInTokenB,
            1e15,
            "[GAP-4] fee en tokenB debe ser en unidades de tokenB"
        );

        // feeInTokenA = amount * 10 / 10000
        uint256 feeInTokenA = (amount * 10) / 10000;

        // agent1 must receive amount - feeInTokenA in tokenA
        assertApproxEqAbs(
            tokenA.balanceOf(agent1),
            agent1TokenABefore + amount - feeInTokenA,
            1e15,
            "[GAP-4] fee en tokenA debe ser en unidades de tokenA"
        );
    }

    // ─── [FIX C-2] Arrays are cleared — preventing DOS ─────────────────────────

    function test_expiredOrdersCleanedFromArrays() public {
        uint256 amount = 1e18;

        // Commit and reveal of a BID order
        bytes32 salt1 = keccak256("s1");
        bytes32 c1 = keccak256(
            abi.encodePacked(
                uint256(3000 * 1e18),
                amount,
                CommitRevealCLOB.Direction.BID,
                salt1
            )
        );
        vm.prank(agent1);
        clob.commitOrder(c1);

        vm.roll(block.number + 1);

        vm.prank(agent1);
        clob.revealOrder(
            1,
            3000 * 1e18,
            amount,
            CommitRevealCLOB.Direction.BID,
            salt1
        );

        // Commit of a second order — expires without revealing
        bytes32 salt2 = keccak256("s2");
        bytes32 c2 = keccak256(
            abi.encodePacked(
                uint256(2990 * 1e18),
                amount,
                CommitRevealCLOB.Direction.BID,
                salt2
            )
        );
        vm.prank(agent1);
        clob.commitOrder(c2);

        // Avanzar — la segunda orden expira
        vm.roll(block.number + 60);
        vm.prank(deployer);
        clob.expireOrder(2);

        // Place an ASK that matches the valid BID (first order)
        bytes32 salt3 = keccak256("s3");
        bytes32 c3 = keccak256(
            abi.encodePacked(
                uint256(2998 * 1e18),
                amount,
                CommitRevealCLOB.Direction.ASK,
                salt3
            )
        );
        vm.prank(agent2);
        clob.commitOrder(c3);

        vm.roll(block.number + 1);

        vm.prank(agent2);
        clob.revealOrder(
            3,
            2998 * 1e18,
            amount,
            CommitRevealCLOB.Direction.ASK,
            salt3
        );

        // Matching must work despite the expired order in the array
        // bid1 (REVEALED) must have matched with the ask
        assertEq(
            uint8(clob.getOrder(1).status),
            uint8(CommitRevealCLOB.OrderStatus.MATCHED),
            "[C-2] El matching debe ignorar ordenes expiradas y usar la valida"
        );
    }

    // ─── [FIX H-2] Withdrawal blocked while orders are active ─────────────────────
    function test_withdrawBlockedWithActiveOrders() public {
        bytes32 salt = keccak256("salt");
        bytes32 commitment = keccak256(
            abi.encodePacked(
                uint256(3000 * 1e18),
                uint256(1e18),
                CommitRevealCLOB.Direction.BID,
                salt
            )
        );

        vm.prank(agent1);
        clob.commitOrder(commitment);

        // Attempt to withdraw collateral with an active order
        vm.prank(agent1);
        vm.expectRevert("Has active orders pending");
        registry.withdrawCollateral(0.001 ether);
    }
}
