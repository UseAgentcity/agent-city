// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BeaconProxy} from "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import {UpgradeableBeacon} from "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";
import {VaultFactoryBaseV2} from "./flap/VaultFactoryBaseV2.sol";
import {IVaultFactoryValidationV2} from "./flap/IVaultFactory.sol";
import {VaultDataSchema, FieldDescriptor, FactoryPolicy} from "./flap/IVaultSchemasV1.sol";
import {IPortalTypes} from "./flap/IPortal.sol";
import {TimesSquareCity} from "./TimesSquareCity.sol";

/// @title Agent City vault factory
/// @notice Flap's VaultPortal calls newVault while it launches a city token: the new city (TimesSquareCity) is
/// created behind a beacon proxy and becomes the token's tax recipient in the same transaction.
///
/// Upgrades: every city of this factory runs the beacon's implementation. Only the upgrade admin (the wallet that
/// deployed this factory, or whoever it hands the role to in two steps) can point the beacon at a new implementation,
/// or lock it for good. Upgrades cannot move the pool by themselves; they replace the city's code.
contract CityVaultFactory is VaultFactoryBaseV2 {
    /// The beacon every city proxy reads its implementation from. Owned by this factory, moved only by the upgrade admin.
    address public immutable beacon;
    /// May upgrade or lock every city of this factory. The deploying wallet at first; zero once upgrades are locked.
    address public upgradeAdmin;
    /// Proposed by the upgrade admin; becomes it on acceptUpgradeAdmin().
    address public pendingAdmin;
    /// The Agent ID registry (ERC-721) that gates entry to every city of this factory.
    address public immutable agentId;

    event CityCreated(
        address indexed city, address indexed taxToken, address indexed creator,
        address operator, address treasury, uint256 epoch, uint256 dayLength
    );
    event Upgraded(address indexed implementation);
    event UpgradesLocked();
    event AdminProposed(address indexed admin);
    event AdminChanged(address indexed admin);

    constructor(address agentId_) {
        require(agentId_.code.length > 0, "agent ID registry");
        agentId = agentId_;
        beacon = address(new UpgradeableBeacon(address(new TimesSquareCity()), address(this)));
        upgradeAdmin = msg.sender;
        emit AdminChanged(msg.sender);
    }

    modifier onlyUpgradeAdmin() {
        require(msg.sender == upgradeAdmin && msg.sender != address(0), "upgrade admin");
        _;
    }

    /// @notice VaultPortal only. `vaultData` = abi.encode(address operator, address treasury, uint256 epoch,
    /// uint256 dayLength). `taxToken` is the token's predicted address and is not called.
    function newVault(address taxToken, address quoteToken, address creator, bytes calldata vaultData)
        external
        override
        returns (address vault)
    {
        require(msg.sender == _getVaultPortal(), "Only VaultPortal");
        require(quoteToken == address(0), "BNB quote only");
        (address operator_, address treasury_, uint256 epoch_, uint256 dayLength_) =
            abi.decode(vaultData, (address, address, uint256, uint256));
        vault = address(
            new BeaconProxy(
                beacon,
                abi.encodeCall(
                    TimesSquareCity.initialize, (taxToken, agentId, creator, operator_, treasury_, epoch_, dayLength_)
                )
            )
        );
        emit CityCreated(vault, taxToken, creator, operator_, treasury_, epoch_, dayLength_);
    }

    /// @notice Cities hold their prize pool in native BNB only.
    function isQuoteTokenSupported(address quoteToken) external pure override returns (bool) {
        return quoteToken == address(0);
    }

    function factorySpecVersion() public pure override returns (string memory) {
        return "v2.4";
    }

    /// @dev A city needs a V3 tax token quoted in BNB that sends all of its tax to the city.
    function _validateBeforeLaunch(IVaultFactoryValidationV2.LaunchValidationDataV1 memory data)
        internal
        pure
        override
        returns (bool, string memory)
    {
        if (data.tokenVersion != IPortalTypes.TokenVersion.TOKEN_TAXED_V3) return (false, "Tax token V3 only");
        if (data.quoteToken != address(0)) return (false, "BNB quote only");
        if (data.vaultBps != 10_000) return (false, "All of the tax must go to the city (vaultBps 10000)");
        return (true, "");
    }

    function tokenCreationPolicies() public pure override returns (FactoryPolicy[] memory p) {
        p = new FactoryPolicy[](3);
        p[0] = FactoryPolicy("quoteToken", "eq", abi.encode(address(0)), "The city's prize pool is in BNB: quote token BNB.");
        p[1] = FactoryPolicy("mktBps", "eq", abi.encode(uint256(10_000)), "All of the tax goes to the city's prize pool.");
        p[2] = FactoryPolicy("tokenVersion", "eq", abi.encode(uint256(6)), "Tax token V3.");
    }

    function vaultDataSchema() public pure override returns (VaultDataSchema memory s) {
        s.description = "Creates an Agent City: a Times Square business game for Agents with a Binance Agent ID, whose "
            "BNB prize pool is this token's tax. The operator posts each season's results; the Flap Guardian can too.";
        s.fields = new FieldDescriptor[](4);
        s.fields[0] = FieldDescriptor("operator", "address", "Wallet that posts season results", 0);
        s.fields[1] = FieldDescriptor("treasury", "address", "Receives 20% of the city tokens Agents spend", 0);
        s.fields[2] = FieldDescriptor("epoch", "time", "When season 1 starts", 0);
        s.fields[3] = FieldDescriptor("dayLength", "uint256", "Seconds per game day (a season is 8 of them), 60 or more", 0);
        s.isArray = false;
    }

    // ---- upgrades: the upgrade admin only ----

    /// @notice Points every city of this factory at a new implementation.
    function upgradeVaultImplementation(address newImplementation) external onlyUpgradeAdmin {
        UpgradeableBeacon(beacon).upgradeTo(newImplementation);
        emit Upgraded(newImplementation);
    }

    /// @notice Makes every city of this factory immutable, for good.
    function lockVaultUpgrades() external onlyUpgradeAdmin {
        UpgradeableBeacon(beacon).renounceOwnership();
        upgradeAdmin = address(0);
        pendingAdmin = address(0);
        emit UpgradesLocked();
    }

    /// @notice Proposes a new upgrade admin; it takes over when it calls acceptUpgradeAdmin().
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

    function isVaultUpgradesLocked() external view returns (bool) {
        return UpgradeableBeacon(beacon).owner() == address(0);
    }

    function beaconImplementation() external view returns (address) {
        return UpgradeableBeacon(beacon).implementation();
    }

    function guardian() external view returns (address) {
        return _getGuardian();
    }

    function vaultPortal() external view returns (address) {
        return _getVaultPortal();
    }
}
