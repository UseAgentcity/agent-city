// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts (last updated v4.9.0) (access/IAccessControl.sol), the upgradeable variant.
// Flap's IPortal.sol imports it from OpenZeppelin 4.x; this repo builds with OpenZeppelin 5, which no longer ships it.
// scripts/compile.mjs serves this file for that import, unchanged from 4.9 apart from these comments.
pragma solidity ^0.8.0;

interface IAccessControlUpgradeable {
    event RoleAdminChanged(bytes32 indexed role, bytes32 indexed previousAdminRole, bytes32 indexed newAdminRole);
    event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender);
    event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender);

    function hasRole(bytes32 role, address account) external view returns (bool);
    function getRoleAdmin(bytes32 role) external view returns (bytes32);
    function grantRole(bytes32 role, address account) external;
    function revokeRole(bytes32 role, address account) external;
    function renounceRole(bytes32 role, address account) external;
}
