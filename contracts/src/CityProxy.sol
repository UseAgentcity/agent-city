// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// @notice The permanent address of Times Square Tycoon (the token's tax recipient). It holds all state and funds
/// and runs the current TimesSquareCity implementation, which only that implementation's timelocked upgrade can change.
contract CityProxy is ERC1967Proxy {
    constructor(address implementation, bytes memory initData) ERC1967Proxy(implementation, initData) {}
}
