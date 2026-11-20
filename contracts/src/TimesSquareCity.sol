// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev The Agent ID registry only needs to answer "does this wallet hold an Agent ID".
interface IAgentId {
    function balanceOf(address wallet) external view returns (uint256);
}

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @title Times Square Tycoon — the city contract
/// @notice Agents with a Binance Agent ID enter a season with a token deposit and send one business plan per game
/// day. The contract records every plan as an event; an open, deterministic engine replays those events into the
/// season's results. The operator publishes the results as a Merkle root; after a public challenge window the
/// tokens the city spent are split 80% burned / 20% to the city treasury, and each Agent claims its BNB award
/// (paid from the token's trading tax that this contract receives) and the unspent part of its deposit.
///
/// Guarantees enforced by this implementation, whatever the operator does:
///  - the operator can never withdraw the BNB pool or any deposit;
///  - a season's BNB awards are at most 25% of the pool not already promised to earlier seasons;
///  - every deposited token is accounted for: spent (burned + treasury) plus refunds equals the deposits;
///  - claims can never exceed the season's published BNB total or refund total;
///  - if a season is not final 14 days after its day 7, everyone takes back exactly what they put in;
///  - no pause, no owner withdrawal.
contract TimesSquareCity is Initializable, UUPSUpgradeable {
    // ---- constants ----
    uint256 public constant DAYS = 7;                      // game days per season; day 8 is the settling day
    uint256 public constant BURN_BPS = 8000;               // of every token spent: 80% burned, 20% to the treasury
    uint256 public constant POOL_SHARE_BPS = 2500;         // a season may award at most 25% of the free pool
    uint256 public constant SPONSOR_RESERVE = 50_000 ether; // minimum bid to sponsor a day's city event (18 decimals)
    uint256 public constant CHALLENGE_WINDOW = 1 hours;
    uint256 public constant CLAIM_WINDOW = 7 days;          // BNB awards expire after this; deposit refunds never do
    uint256 public constant RESCUE_AFTER = 14 days;         // a season not final this long after day 7 refunds everyone
    uint256 public constant MAX_ACTIONS = 1024;             // plan bytes (UTF-8 JSON, decoded by the engine)
    uint256 public constant MAX_MEMO = 160;                 // memo bytes
    address public constant BURN = 0x000000000000000000000000000000000000dEaD;

    // ---- set at initialization ----
    IAgentId public agentId;
    address public operator;   // publishes season results and sets the token once; nothing else
    address public treasury;   // receives 20% of tokens spent (a public multisig)
    uint256 public epoch;      // start of season 1
    uint256 public dayLength;  // seconds per game day
    IERC20 public token;       // the city token; set once by the operator after it is launched

    // ---- seasons ----
    struct Season {
        uint256 deposits;      // tokens deposited by Agents this season
        uint256 sponsorBids;   // tokens held for the current top sponsor bids
        bytes32 root;          // Merkle root of (season, agent, bnb, tokens) leaves
        uint256 bnbTotal;      // BNB promised to this season's winners
        uint256 bnbClaimed;
        uint256 tokensSpent;   // tokens the season consumed (leases, screens, upgrades, licences + winning sponsors)
        uint256 refunds;       // tokens returned to Agents (unspent deposits)
        uint256 refundsClaimed;
        uint64 publishedAt;
        uint64 claimUntil;     // set when final
        bool challenged;
        bool finalized;
        bool released;
        bool abandoned;        // never finalized: every deposit and sponsor bid goes back as it came
        string resultUri;      // where the full results and proofs are published
    }
    struct Bid { address who; uint256 amount; uint8 eventId; }

    mapping(uint256 => Season) internal seasons;
    mapping(uint256 => mapping(address => uint256)) public depositOf;   // season => agent => tokens
    mapping(uint256 => mapping(address => bool)) public entered;
    mapping(uint256 => mapping(address => uint256)) public planDays;    // season => agent => bitmask of days planned
    mapping(uint256 => mapping(uint256 => Bid)) public topBid;          // season => day => leading sponsor bid
    mapping(uint256 => mapping(address => bool)) public claimed;
    mapping(uint256 => mapping(address => bool)) public challengedBy;
    /// BNB promised to published seasons and not yet claimed or released.
    uint256 public reserved;

    // ---- admin ----
    address public upgradeAdmin;
    address public pendingAdmin;

    // ---- events (the engine's input, in block and log order) ----
    event TokenSet(address token);
    event Funded(address indexed from, uint256 amount);
    event Entered(uint256 indexed season, address indexed agent, uint256 deposit);
    event Planned(uint256 indexed season, uint256 indexed day, address indexed agent, bytes actions, string memo);
    event Sponsored(uint256 indexed season, uint256 indexed day, address indexed who, uint8 eventId, uint256 bid);
    event Published(uint256 indexed season, bytes32 root, uint256 bnbTotal, uint256 tokensSpent, uint256 refunds, string resultUri);
    event Challenged(uint256 indexed season, address indexed by, string reason);
    event Finalized(uint256 indexed season, uint256 burned, uint256 toTreasury, uint64 claimUntil);
    event Claimed(uint256 indexed season, address indexed agent, uint256 bnb, uint256 tokens);
    event Released(uint256 indexed season, uint256 bnb);
    event Rescued(uint256 indexed season, address indexed who, uint256 tokens);
    event AdminProposed(address indexed admin);
    event AdminChanged(address indexed admin);
    event UpgradesFrozen();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers(); // the implementation itself is never used directly
    }

    /// @notice Run once at deployment.
    function initialize(address agentId_, address operator_, address treasury_, uint256 epoch_, uint256 dayLength_) external initializer {
        require(agentId_.code.length > 0, "agent ID registry");
        require(operator_ != address(0) && treasury_ != address(0), "roles");
        require(dayLength_ >= 60, "day length");
        __UUPSUpgradeable_init();
        agentId = IAgentId(agentId_);
        operator = operator_;
        treasury = treasury_;
        upgradeAdmin = msg.sender;
        epoch = epoch_;
        dayLength = dayLength_;
        emit AdminChanged(msg.sender);
    }

    /// @notice The token's trading tax (BNB) arrives here and only grows the prize pool. Flap may also "ping" with
    /// zero value; that is a no-op.
    receive() external payable {
        if (msg.value > 0) emit Funded(msg.sender, msg.value);
    }

    /// @notice Set the city token once, after it is launched with this contract as its tax recipient.
    function setToken(address token_) external {
        require(msg.sender == operator, "operator");
        require(address(token) == address(0) && token_.code.length > 0, "token");
        token = IERC20(token_);
        emit TokenSet(token_);
    }

    // ---- admin ----

    modifier onlyUpgradeAdmin() {
        require(msg.sender == upgradeAdmin && msg.sender != address(0), "upgrade admin");
        _;
    }

    /// @dev Called by upgradeToAndCall.
    function _authorizeUpgrade(address) internal override onlyUpgradeAdmin {}

    function transferUpgradeAdmin(address admin) external onlyUpgradeAdmin {
        pendingAdmin = admin;
        emit AdminProposed(admin);
    }

    function acceptUpgradeAdmin() external {
        require(msg.sender == pendingAdmin && msg.sender != address(0), "not proposed");
        upgradeAdmin = msg.sender;
        pendingAdmin = address(0);
        emit AdminChanged(msg.sender);
    }

    function freezeUpgrades() external onlyUpgradeAdmin {
        upgradeAdmin = address(0);
        pendingAdmin = address(0);
        emit UpgradesFrozen();
    }

    /// @notice Everything about a season's books and settlement.
    function seasonInfo(uint256 season) external view returns (Season memory) {
        return seasons[season];
    }

    // ---- clock ----

    /// @notice The current season (1-based) and game day: 1..7 while trading, 8 on the settling day. Day 0 before season 1.
    function clock() public view returns (uint256 season, uint256 day) {
        if (block.timestamp < epoch) return (1, 0);
        uint256 elapsed = block.timestamp - epoch;
        uint256 len = dayLength * (DAYS + 1);
        season = elapsed / len + 1;
        day = (elapsed % len) / dayLength + 1;
    }

    function seasonEnd(uint256 season) public view returns (uint256) {
        return epoch + (season - 1) * dayLength * (DAYS + 1) + DAYS * dayLength;
    }

    /// @dev Day 1 plans (with the lease bids) are taken only on the previous season's settling day (or before
    /// season 1 starts): the auction settles as the season opens, so nothing may change it afterwards. Days 2-7
    /// only while they are the current game day.
    function _open(uint256 season, uint256 day) internal view returns (bool) {
        (uint256 s, uint256 d) = clock();
        if (day == 0 || day > DAYS) return false;
        if (d == 0) return season == 1 && day == 1; // before season 1 starts
        if (season == s) return day > 1 && d == day;
        return day == 1 && season == s + 1 && d == DAYS + 1;
    }

    // ---- Agents ----

    /// @notice Join a season with a token deposit (0 is fine: market stalls are free). Once per wallet per season,
    /// from the settling day before it until the end of its day 7. Approve the deposit first.
    function enter(uint256 season, uint256 deposit) external {
        require(agentId.balanceOf(msg.sender) > 0, "agent ID");
        require(!entered[season][msg.sender], "already entered");
        (uint256 s, uint256 d) = clock();
        require((season == s && d >= 1 && d <= DAYS) || _open(season, 1), "not open");
        entered[season][msg.sender] = true;
        if (deposit > 0) {
            require(address(token) != address(0), "no token yet");
            _pull(msg.sender, deposit);
            depositOf[season][msg.sender] = deposit;
            seasons[season].deposits += deposit;
        }
        emit Entered(season, msg.sender, deposit);
    }

    /// @notice Today's business plan: one per Agent per game day. `actions` is UTF-8 JSON read by the engine.
    function plan(uint256 season, uint256 day, bytes calldata actions, string calldata memo) external {
        require(entered[season][msg.sender], "not entered");
        require(agentId.balanceOf(msg.sender) > 0, "agent ID");
        require(_open(season, day), "not open");
        require(actions.length <= MAX_ACTIONS && bytes(memo).length <= MAX_MEMO, "too long");
        uint256 bit = 1 << day;
        require(planDays[season][msg.sender] & bit == 0, "already planned");
        planDays[season][msg.sender] |= bit;
        emit Planned(season, day, msg.sender, actions, memo);
    }

    /// @notice Bid tokens to choose a day's city event. Bids for day d are taken on day d-1 (day 1: the settling
    /// day before). The leading bid is held; an outbid sponsor is refunded at once. Only the winner pays.
    function sponsor(uint256 season, uint256 day, uint8 eventId, uint256 bid) external {
        require(address(token) != address(0), "no token yet");
        require(day >= 1 && day <= DAYS, "day");
        (uint256 s, uint256 d) = clock();
        bool open = day == 1 ? (season == s + 1 && d == DAYS + 1) || (season == 1 && d == 0) : (season == s && d == day - 1);
        require(open, "not open");
        Bid storage top = topBid[season][day];
        require(bid >= SPONSOR_RESERVE && bid > top.amount, "bid too low");
        _pull(msg.sender, bid);
        (address prev, uint256 prevAmount) = (top.who, top.amount);
        seasons[season].sponsorBids = seasons[season].sponsorBids - prevAmount + bid;
        topBid[season][day] = Bid(msg.sender, bid, eventId);
        if (prev != address(0)) _push(prev, prevAmount);
        emit Sponsored(season, day, msg.sender, eventId, bid);
    }

    // ---- settlement ----

    /// @notice BNB a newly published season may award: 25% of the pool not promised to other seasons.
    function seasonBudget() public view returns (uint256) {
        return (address(this).balance - reserved) * POOL_SHARE_BPS / 10_000;
    }

    /// @notice The operator posts a season's results once its day 7 is over, and may re-post while unfinalized
    /// (after a challenge). `tokensSpent` covers what Agents spent from their deposits; winning sponsor bids are
    /// added on chain. Spent plus refunds must equal the deposits exactly.
    function publish(uint256 season, bytes32 root, uint256 bnbTotal, uint256 tokensSpent, uint256 refunds, string calldata resultUri) external {
        require(msg.sender == operator, "operator");
        require(block.timestamp >= seasonEnd(season), "season running");
        Season storage x = seasons[season];
        require(!x.finalized && !x.abandoned, "final");
        require(root != bytes32(0), "root");
        require(tokensSpent + refunds == x.deposits, "deposits");
        reserved -= x.bnbTotal; // a re-post replaces the earlier promise
        require(bnbTotal <= seasonBudget(), "over budget");
        reserved += bnbTotal;
        x.root = root;
        x.bnbTotal = bnbTotal;
        x.tokensSpent = tokensSpent;
        x.refunds = refunds;
        x.publishedAt = uint64(block.timestamp);
        x.challenged = false;
        x.resultUri = resultUri;
        emit Published(season, root, bnbTotal, tokensSpent, refunds, resultUri);
    }

    /// @notice Within an hour of a post, any Agent of that season may dispute it; claims wait for a re-post.
    function challenge(uint256 season, string calldata reason) external {
        Season storage x = seasons[season];
        require(x.publishedAt != 0 && !x.finalized && block.timestamp < x.publishedAt + CHALLENGE_WINDOW, "window");
        require(entered[season][msg.sender] && !challengedBy[season][msg.sender], "challenger");
        challengedBy[season][msg.sender] = true;
        x.challenged = true;
        emit Challenged(season, msg.sender, reason);
    }

    /// @notice Anyone, once the window has passed without a challenge: burn 80% and send 20% of everything the
    /// season spent (deposit spending plus winning sponsor bids) to the treasury, and open claims for 7 days.
    function finalize(uint256 season) public {
        Season storage x = seasons[season];
        require(x.publishedAt != 0 && !x.finalized && !x.abandoned && !x.challenged && block.timestamp >= x.publishedAt + CHALLENGE_WINDOW, "not ready");
        x.finalized = true;
        x.claimUntil = uint64(block.timestamp + CLAIM_WINDOW);
        uint256 spent = x.tokensSpent + x.sponsorBids;
        uint256 burned = spent * BURN_BPS / 10_000;
        if (burned > 0) _push(BURN, burned);
        if (spent > burned) _push(treasury, spent - burned);
        emit Finalized(season, burned, spent - burned, x.claimUntil);
    }

    /// @notice An Agent collects its BNB award (until the claim window closes) and its unspent deposit (any time).
    function claim(uint256 season, uint256 bnb, uint256 tokens, bytes32[] calldata proof) external {
        Season storage x = seasons[season];
        if (!x.finalized) finalize(season);
        require(!claimed[season][msg.sender], "claimed");
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(season, msg.sender, bnb, tokens))));
        require(_verify(proof, x.root, leaf), "proof");
        claimed[season][msg.sender] = true;
        uint256 pay = block.timestamp <= x.claimUntil && !x.released ? bnb : 0;
        // The root is the operator's; the totals are the contract's. No leaf can take more than the season holds.
        require(x.bnbClaimed + pay <= x.bnbTotal && x.refundsClaimed + tokens <= x.refunds, "over total");
        x.refundsClaimed += tokens;
        if (pay > 0) {
            x.bnbClaimed += pay;
            reserved -= pay;
        }
        if (tokens > 0) _push(msg.sender, tokens);
        if (pay > 0) {
            (bool ok,) = payable(msg.sender).call{value: pay}("");
            require(ok, "bnb");
        }
        emit Claimed(season, msg.sender, pay, tokens);
    }

    /// @notice Anyone, after the claim window: unclaimed BNB goes back to the pool for later seasons.
    function release(uint256 season) external {
        Season storage x = seasons[season];
        require(x.finalized && !x.released && block.timestamp > x.claimUntil, "not yet");
        x.released = true;
        uint256 left = x.bnbTotal - x.bnbClaimed;
        reserved -= left;
        emit Released(season, left);
    }

    /// @notice If a season is still not final 14 days after its day 7 (no post, or a challenge never resolved),
    /// each Agent takes back its whole deposit and each sponsor its held bids. The season can then never be posted.
    function rescue(uint256 season) external {
        Season storage x = seasons[season];
        require(!x.finalized && block.timestamp > seasonEnd(season) + RESCUE_AFTER, "not abandoned");
        if (!x.abandoned) {
            x.abandoned = true;
            reserved -= x.bnbTotal;
        }
        uint256 back = depositOf[season][msg.sender];
        depositOf[season][msg.sender] = 0;
        for (uint256 day = 1; day <= DAYS; day++) {
            Bid storage b = topBid[season][day];
            if (b.who == msg.sender && b.amount > 0) {
                back += b.amount;
                b.amount = 0;
            }
        }
        require(back > 0, "nothing");
        _push(msg.sender, back);
        emit Rescued(season, msg.sender, back);
    }

    // ---- internals ----

    function _pull(address from, uint256 amount) internal {
        uint256 before = _balance();
        (bool ok, bytes memory data) = address(token).call(abi.encodeCall(IERC20.transferFrom, (from, address(this), amount)));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "transferFrom");
        // A fee-on-transfer token must not make the books promise more than the contract holds.
        require(_balance() - before == amount, "taxed transfer");
    }

    function _push(address to, uint256 amount) internal {
        (bool ok, bytes memory data) = address(token).call(abi.encodeCall(IERC20.transfer, (to, amount)));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "transfer");
    }

    function _balance() internal view returns (uint256 b) {
        (bool ok, bytes memory data) = address(token).staticcall(abi.encodeWithSignature("balanceOf(address)", address(this)));
        require(ok && data.length >= 32, "balanceOf");
        b = abi.decode(data, (uint256));
    }

    /// @dev Sorted-pair Merkle proof (OpenZeppelin-compatible), leaves double-hashed.
    function _verify(bytes32[] calldata proof, bytes32 root, bytes32 leaf) internal pure returns (bool) {
        bytes32 h = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 p = proof[i];
            h = h < p ? keccak256(abi.encodePacked(h, p)) : keccak256(abi.encodePacked(p, h));
        }
        return h == root;
    }
}
