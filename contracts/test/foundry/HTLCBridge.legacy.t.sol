// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {HTLCBridge} from "../../contracts/HTLCBridge.sol";

/**
 * The legacy bridge refuses to open a new lock once a v2 escrow is active:
 * funds must go through HTLCEscrow instead, so the old path cannot be used to
 * strand an order that the v2 coordinator will never see.
 */
contract HTLCBridgeLegacyLockTest is Test {
    HTLCBridge bridge;

    function setUp() public {
        bridge = new HTLCBridge(address(0));
        vm.deal(address(this), 1 ether);
    }

    function _lock(address target) internal {
        bridge.newLock{value: 0.01 ether}(
            bytes32(uint256(1)),
            target,
            0.01 ether,
            block.timestamp + 2 hours
        );
    }

    function test_legacyLockRevertsWhenV2EscrowIsActive() public {
        address v2 = address(0xBEEF);
        bridge.setActiveV2Escrow(v2);

        vm.expectRevert(bytes("Legacy lock rejected: v2 escrow active"));
        _lock(address(0xCAFE));
    }

    function test_legacyLockSucceedsWhenV2IsUnset() public {
        _lock(address(0xCAFE));
        assertTrue(bridge.locked(bytes32(uint256(1))));
    }

    function test_legacyLockToTheActiveV2EscrowIsAllowed() public {
        address v2 = address(0xBEEF);
        bridge.setActiveV2Escrow(v2);

        // The gate refuses a legacy target, not a lock that names the v2 escrow.
        _lock(v2);
        assertTrue(bridge.locked(bytes32(uint256(1))));
    }

    function test_legacyLockRejectsADuplicateHashlock() public {
        _lock(address(0xCAFE));

        vm.expectRevert(bytes("Already locked"));
        _lock(address(0xCAFE));
    }

    function test_legacyLockRejectsAMismatchedValue() public {
        vm.expectRevert(bytes("Amount mismatch"));
        bridge.newLock(
            bytes32(uint256(2)),
            address(0xCAFE),
            0.01 ether,
            block.timestamp + 2 hours
        );
    }
}
