// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./AgentRegistry.sol";

contract CommitRevealCLOB is ReentrancyGuard, Ownable {

    // ─── Enums ─────────────────────────────────────────────────────────────────

    enum Direction   { BID, ASK }
    enum OrderStatus { COMMITTED, REVEALED, MATCHED, EXPIRED }

    // ─── Structs ───────────────────────────────────────────────────────────────

    struct Order {
        address     agent;
        bytes32     commitment;
        uint256     price;
        uint256     amount;
        Direction   direction;
        OrderStatus status;
        uint256     commitBlock;
        uint256     revealBlock;
    }

    // ─── State ─────────────────────────────────────────────────────────────────

    AgentRegistry public registry;
    IERC20        public tokenA;
    IERC20        public tokenB;

    mapping(uint256 => Order) public orders;
    uint256 public orderCount;

    uint256 public constant REVEAL_WINDOW       = 50;
    uint256 public constant EXPIRE_GRACE_PERIOD = 1;   // [FIX C-3]
    uint256 public constant FEE_BPS             = 10;  // 0.10%
    uint256 public constant BPS_DENOMINATOR     = 10000;

    uint256[] public openBids;
    uint256[] public openAsks;

    address public protocolFeeRecipient; // [FIX C-1]
    address public keeperAddress;        // [FIX C-3]
    uint256 public lastMatchBlock;       // [FIX M-2]

    // ─── Events ────────────────────────────────────────────────────────────────

    event OrderCommitted(
        uint256 indexed orderId,
        address indexed agent,
        bytes32         commitment,
        uint256         blockNumber
    );

    event OrderRevealed(
        uint256 indexed orderId,
        address indexed agent,
        uint256         price,
        uint256         amount,
        Direction       direction,
        uint256         blockNumber
    );

    // [FIX M-1] reordered
    event OrderMatched(
        uint256 indexed bidId,
        uint256 indexed askId,
        uint256         price,
        uint256         amount,
        uint256         fee,
        address         bidAgent,
        address         askAgent
    );

    event OrderExpired(
        uint256 indexed orderId,
        address indexed agent,
        uint256         blockNumber
    );

    // ─── Constructor ───────────────────────────────────────────────────────────

    constructor(
        address _registry,
        address _tokenA,
        address _tokenB
    ) Ownable(msg.sender) {
        registry = AgentRegistry(_registry);
        tokenA   = IERC20(_tokenA);
        tokenB   = IERC20(_tokenB);
    }

    // ─── Admin ─────────────────────────────────────────────────────────────────

    function setFeeRecipient(address recipient) external onlyOwner {
        require(recipient != address(0), "Zero address");
        protocolFeeRecipient = recipient;
    }

    function setKeeper(address _keeper) external onlyOwner {
        keeperAddress = _keeper;
    }

    // ─── Commit Phase ──────────────────────────────────────────────────────────

    function commitOrder(bytes32 commitment) external returns (uint256 orderId) {
        require(registry.isRegistered(msg.sender), "Agent not registered");

        registry.incrementActiveOrders(msg.sender); // [FIX H-2]

        orderId = ++orderCount;

        orders[orderId] = Order({
            agent:       msg.sender,
            commitment:  commitment,
            price:       0,
            amount:      0,
            direction:   Direction.BID,
            status:      OrderStatus.COMMITTED,
            commitBlock: block.number,
            revealBlock: 0
        });

        emit OrderCommitted(orderId, msg.sender, commitment, block.number);
    }

    // ─── Reveal Phase ──────────────────────────────────────────────────────────

    function revealOrder(
        uint256   orderId,
        uint256   price,
        uint256   amount,
        Direction direction,
        bytes32   salt
    ) external nonReentrant {
        Order storage order = orders[orderId];

        require(order.agent == msg.sender,                         "Not your order");
        require(order.status == OrderStatus.COMMITTED,             "Wrong status");
        require(block.number >= order.commitBlock + 1,             "Too early to reveal");
        require(block.number <= order.commitBlock + REVEAL_WINDOW, "Reveal window expired");
        require(price > 0 && amount > 0,                           "Invalid params");

        bytes32 expectedCommitment = keccak256(
            abi.encodePacked(price, amount, direction, salt)
        );
        require(order.commitment == expectedCommitment, "Commitment mismatch");

        order.price       = price;
        order.amount      = amount;
        order.direction   = direction;
        order.status      = OrderStatus.REVEALED;
        order.revealBlock = block.number;

        // [FIX GAP-2] decrement BEFORE emitting event
        registry.decrementActiveOrders(msg.sender);

        if (direction == Direction.BID) {
            openBids.push(orderId);
        } else {
            openAsks.push(orderId);
        }

        emit OrderRevealed(orderId, msg.sender, price, amount, direction, block.number);

        _tryMatch();
    }

    // ─── Matching Engine ───────────────────────────────────────────────────────

    // [FIX M-2] 
    function matchOrders() external {
        if (block.number == lastMatchBlock) return;
        lastMatchBlock = block.number;
        _tryMatch();
    }

    function _tryMatch() internal {
        if (openBids.length == 0 || openAsks.length == 0) return;

        (uint256 bestBidIdx, uint256 bestBidId) = _findBestBid();
        (uint256 bestAskIdx, uint256 bestAskId) = _findBestAsk();

        if (bestBidId == 0 || bestAskId == 0) return;

        Order storage bid = orders[bestBidId];
        Order storage ask = orders[bestAskId];

        if (bid.price < ask.price) return;

        uint256 execPrice  = (bid.price + ask.price) / 2;
        uint256 execAmount = bid.amount < ask.amount ? bid.amount : ask.amount;

        _settle(bid.agent, ask.agent, execPrice, execAmount);

        // Calculate fees in their respective units for the event
        uint256 totalCost   = (execPrice * execAmount) / 1e18;
        uint256 feeInTokenB = (totalCost  * FEE_BPS) / BPS_DENOMINATOR;
        uint256 feeInTokenA = (execAmount * FEE_BPS) / BPS_DENOMINATOR;

        // [FIX V6] 
        // feeInTokenA (WETH) × execPrice (USDC/WETH) / 1e18 = USDC 
        uint256 feeInTokenAasTokenB = (feeInTokenA * execPrice) / 1e18;

        registry.updateStats(bid.agent, execAmount, feeInTokenAasTokenB / 2);
        registry.updateStats(ask.agent, execAmount, feeInTokenB / 2);

        bid.status = OrderStatus.MATCHED;
        ask.status = OrderStatus.MATCHED;

        _removeFromArray(openBids, bestBidIdx);
        _removeFromArray(openAsks, bestAskIdx);

        emit OrderMatched(
            bestBidId, bestAskId,
            execPrice, execAmount,
            feeInTokenA + feeInTokenB,
            bid.agent, ask.agent
        );
    }

    // ─── Settlement [FIX C-1 + GAP-4] ─────────────────────────────────────────

    function _settle(
        address bidAgent,
        address askAgent,
        uint256 price,
        uint256 execAmount
    ) internal {
        uint256 totalCost = (price * execAmount) / 1e18;
        address feeTarget = protocolFeeRecipient != address(0)
                            ? protocolFeeRecipient
                            : owner();

        // [FIX GAP-4] independent fee for each token
        uint256 feeInTokenB = (totalCost  * FEE_BPS) / BPS_DENOMINATOR;
        uint256 feeInTokenA = (execAmount * FEE_BPS) / BPS_DENOMINATOR;

        require(
            tokenB.transferFrom(bidAgent, askAgent, totalCost - feeInTokenB),
            "TokenB transfer failed"
        );
        if (feeInTokenB > 0) {
            require(
                tokenB.transferFrom(bidAgent, feeTarget, feeInTokenB),
                "TokenB fee transfer failed"
            );
        }

        require(
            tokenA.transferFrom(askAgent, bidAgent, execAmount - feeInTokenA),
            "TokenA transfer failed"
        );
        if (feeInTokenA > 0) {
            require(
                tokenA.transferFrom(askAgent, feeTarget, feeInTokenA),
                "TokenA fee transfer failed"
            );
        }
    }

    // ─── Expire [FIX C-3 + GAP-2] ─────────────────────────────────────────────

    function expireOrder(uint256 orderId) external {
        Order storage order = orders[orderId];

        require(order.status == OrderStatus.COMMITTED, "Not committed");
        require(
            block.number > order.commitBlock + REVEAL_WINDOW + EXPIRE_GRACE_PERIOD,
            "Grace period still active"
        );

        order.status = OrderStatus.EXPIRED;

        // [FIX GAP-2] decrement FIRST, slash AFTER
        registry.decrementActiveOrders(order.agent);

        emit OrderExpired(orderId, order.agent, block.number);

        if (msg.sender == owner() || msg.sender == keeperAddress) {
            registry.slashAgent(order.agent, "Failed to reveal in time");
        }
    }

    // ─── Matching Helpers [FIX C-2] ────────────────────────────────────────────

    function _findBestBid() internal returns (uint256 idx, uint256 orderId) {
        uint256 bestPrice = 0;
        uint256 i = 0;
        while (i < openBids.length) {
            Order storage o = orders[openBids[i]];
            if (o.status != OrderStatus.REVEALED) {
                _removeFromArray(openBids, i);
                continue;
            }
            if (o.price > bestPrice) {
                bestPrice = o.price;
                idx       = i;
                orderId   = openBids[i];
            }
            unchecked { ++i; }
        }
    }

    function _findBestAsk() internal returns (uint256 idx, uint256 orderId) {
        uint256 bestPrice = type(uint256).max;
        uint256 i = 0;
        while (i < openAsks.length) {
            Order storage o = orders[openAsks[i]];
            if (o.status != OrderStatus.REVEALED) {
                _removeFromArray(openAsks, i);
                continue;
            }
            if (o.price < bestPrice) {
                bestPrice = o.price;
                idx       = i;
                orderId   = openAsks[i];
            }
            unchecked { ++i; }
        }
    }

    function _removeFromArray(uint256[] storage arr, uint256 idx) internal {
        arr[idx] = arr[arr.length - 1];
        arr.pop();
    }

    // ─── Agent helper function ───────────────────────────────────────────────────

    function hashOrder(
        uint256   price,
        uint256   amount,
        Direction direction,
        bytes32   salt
    ) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(price, amount, direction, salt));
    }

    // ─── Views ─────────────────────────────────────────────────────────────────

    function getOrder(uint256 orderId) external view returns (Order memory) {
        return orders[orderId];
    }

    function getOpenBids() external view returns (uint256[] memory) {
        return openBids;
    }

    function getOpenAsks() external view returns (uint256[] memory) {
        return openAsks;
    }
}