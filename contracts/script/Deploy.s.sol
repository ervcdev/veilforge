// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/MockERC20.sol";
import "../src/AgentRegistry.sol";
import "../src/CommitRevealCLOB.sol";
import "../src/ReactivityAdapter.sol";

contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);

        address agent1 = vm.envAddress("AGENT_1_ADDRESS");
        address agent2 = vm.envAddress("AGENT_2_ADDRESS");
        address agent3 = vm.envAddress("AGENT_3_ADDRESS");

        // ── Iniciar Transmisión Única Unificada ──────────────────────────
        vm.startBroadcast(deployerKey);

        // ── 1. Token A ───────────────────────────────────────────────────
        MockERC20 tokenA = new MockERC20("Wrapped ETH Mock", "WETH", 18);
        console.log("TokenA (WETH):", address(tokenA));

        // Truco 1: Avanzar bloques localmente en el entorno de simulación de Foundry
        // para romper la ráfaga exacta de nonces/timestamps de cara al nodo
        vm.roll(block.number + 5); 

        // ── 2. Token B ───────────────────────────────────────────────────
        // Truco 2: Alteramos levemente el string del nombre agregando un espacio imperceptible al final
        // Esto cambia el hash del input del despliegue y evita colisiones en la mempool de Somnia
        MockERC20 tokenB = new MockERC20("USD Coin Mock ", "USDC", 18);
        console.log("TokenB (USDC):", address(tokenB));

        vm.roll(block.number + 5);

        // ── 3. AgentRegistry ───────────────────────────────────────────────────
        AgentRegistry registry = new AgentRegistry();
        console.log("AgentRegistry:", address(registry));

        // ── 4. CommitRevealCLOB ────────────────────────────────────────────────
        CommitRevealCLOB clob = new CommitRevealCLOB(
            address(registry),
            address(tokenA),
            address(tokenB)
        );
        console.log("CommitRevealCLOB:", address(clob));

        // ── 5. Conectar Registry → CLOB ────────────────────────────────────────
        registry.setCLOBContract(address(clob));
        console.log("Registry connected to CLOB");

        // ── 6. Fee recipient [FIX C-1] ─────────────────────────────────────────
        clob.setFeeRecipient(deployer);
        console.log("Fee recipient:", deployer);

        // ── 7. ReactivityAdapter [FIX M-3] ────────────────────────────────────
        ReactivityAdapter adapter = new ReactivityAdapter(
            address(clob),
            address(0x0100)
        );
        console.log("ReactivityAdapter:", address(adapter));

        // ── 8. Keeper [FIX C-3] ────────────────────────────────────────────────
        clob.setKeeper(address(adapter));
        console.log("Keeper set to adapter");

        // ── 9. Mintear tokens a agentes ────────────────────────────────────────
        uint256 mintAmount = 10_000 * 1e18;

        tokenA.mint(agent1, mintAmount);
        tokenA.mint(agent2, mintAmount);
        tokenA.mint(agent3, mintAmount);

        tokenB.mint(agent1, mintAmount);
        tokenB.mint(agent2, mintAmount);
        tokenB.mint(agent3, mintAmount);

        console.log("Minted 10,000 WETH + 10,000 USDC to each agent");

        // ── Finalizar Transmisión ─────────────────────────────────────────────
        vm.stopBroadcast();

        // ── Output para copiar al .env ─────────────────────────────────────────
        console.log("\n==============================");
        console.log("=== COPY TO agent/.env      ===");
        console.log("==============================");
        console.log("COMMIT_REVEAL_CLOB_ADDRESS=",  address(clob));
        console.log("AGENT_REGISTRY_ADDRESS=",      address(registry));
        console.log("REACTIVITY_ADAPTER_ADDRESS=",  address(adapter));
        console.log("TOKEN_A_ADDRESS=",             address(tokenA));
        console.log("TOKEN_B_ADDRESS=",             address(tokenB));
        console.log("==============================");
        console.log("=== COPY TO frontend/.env.local ===");
        console.log("NEXT_PUBLIC_CLOB_ADDRESS=",     address(clob));
        console.log("NEXT_PUBLIC_REGISTRY_ADDRESS=", address(registry));
        console.log("NEXT_PUBLIC_TOKEN_A_ADDRESS=",  address(tokenA));
        console.log("NEXT_PUBLIC_TOKEN_B_ADDRESS=",  address(tokenB));
        console.log("==============================");
    }
}