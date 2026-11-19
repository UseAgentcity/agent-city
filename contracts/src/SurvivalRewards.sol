// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ISurvivalAgentId {
    function balanceOf(address wallet) external view returns (uint256);
}

/// @notice The city operator reserves a verified survival award for one specific Agent ID holder.
contract SurvivalRewards {
    ISurvivalAgentId public immutable registry;
    address public immutable operator;

    struct Award {
        uint256 amount;
        bytes32 result;
        bool paid;
    }
    mapping(address => mapping(uint256 => Award)) public awards;
    mapping(address => bool) public activeCareer;

    event CareerActivated(address indexed agent);
    event Reserved(address indexed agent, uint256 indexed week, bytes32 result, uint256 amount);
    event Paid(address indexed agent, uint256 indexed week, uint256 amount);

    constructor(address agentId) {
        require(agentId.code.length > 0, "registry");
        registry = ISurvivalAgentId(agentId);
        operator = msg.sender;
    }

    function activateCareer() external {
        require(!activeCareer[msg.sender], "already active");
        require(registry.balanceOf(msg.sender) > 0, "agent ID");
        activeCareer[msg.sender] = true;
        emit CareerActivated(msg.sender);
    }

    function reserve(address agent, uint256 week, bytes32 result) external payable {
        require(msg.sender == operator, "operator");
        require(week > 0 && result != bytes32(0) && msg.value > 0, "award");
        require(activeCareer[agent] && registry.balanceOf(agent) > 0, "agent ID");
        require(awards[agent][week].amount == 0, "already reserved");
        awards[agent][week] = Award(msg.value, result, false);
        emit Reserved(agent, week, result, msg.value);
    }

    function claim(uint256 week) external {
        Award storage award = awards[msg.sender][week];
        require(award.amount > 0 && !award.paid, "unavailable");
        award.paid = true;
        (bool sent,) = payable(msg.sender).call{value: award.amount}("");
        require(sent, "transfer");
        emit Paid(msg.sender, week, award.amount);
    }
}
