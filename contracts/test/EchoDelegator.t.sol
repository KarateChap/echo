// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test} from "forge-std/Test.sol";
import {EchoDelegator} from "../src/EchoDelegator.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";

/// @dev Mock ERC-20 for testing
contract MockERC20 is IERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract EchoDelegatorTest is Test {
    EchoDelegator delegator;
    MockERC20 usdc;

    address user = address(0xBEEF);
    address agent = address(0xA6E1);
    address recipient = address(0xCAFE);

    function setUp() public {
        delegator = new EchoDelegator();
        usdc = new MockERC20();

        // Fund user EOA with mock USDC
        usdc.mint(user, 10_000e6);
        // Fund user EOA with ETH
        vm.deal(user, 10 ether);
    }

    // --- Helpers ---

    /// @dev Simulate EIP-7702: deploy delegator code at user's address and call delegate()
    function _delegateAsUser(
        address _recipient,
        address _token,
        uint256 _maxPerCycle,
        uint256 _cycleSeconds,
        uint256 _expiresAt
    ) internal {
        // EIP-7702 sets the delegator's code at the user's EOA.
        // We simulate this by etching the delegator's runtime bytecode onto the user address.
        vm.etch(user, address(delegator).code);

        // Call delegate() as the user (msg.sender = user = address(this) in EOA context)
        vm.prank(user);
        EchoDelegator(payable(user)).delegate(agent, _recipient, _token, _maxPerCycle, _cycleSeconds, _expiresAt);
    }

    // --- delegate() tests ---

    function test_delegate_stores_permission() public {
        _delegateAsUser(recipient, address(usdc), 1000e6, 30 days, 0);

        EchoDelegator.Permission memory perm = EchoDelegator(payable(user)).getPermission(recipient, address(usdc));
        assertEq(perm.agent, agent);
        assertEq(perm.maxPerCycle, 1000e6);
        assertEq(perm.cycleSeconds, 30 days);
        assertEq(perm.expiresAt, 0);
        assertTrue(perm.active);
        assertEq(perm.spentThisCycle, 0);
    }

    function test_delegate_reverts_if_not_owner() public {
        vm.etch(user, address(delegator).code);

        // Try to delegate as a random address (not the EOA owner)
        vm.prank(address(0xBAD));
        vm.expectRevert(EchoDelegator.Unauthorized.selector);
        EchoDelegator(payable(user)).delegate(agent, recipient, address(usdc), 1000e6, 30 days, 0);
    }

    function test_delegate_reverts_zero_agent() public {
        vm.etch(user, address(delegator).code);
        vm.prank(user);
        vm.expectRevert(EchoDelegator.InvalidAgent.selector);
        EchoDelegator(payable(user)).delegate(address(0), recipient, address(usdc), 1000e6, 30 days, 0);
    }

    function test_delegate_reverts_zero_max() public {
        vm.etch(user, address(delegator).code);
        vm.prank(user);
        vm.expectRevert(EchoDelegator.InvalidMaxPerCycle.selector);
        EchoDelegator(payable(user)).delegate(agent, recipient, address(usdc), 0, 30 days, 0);
    }

    // --- executeTransfer() tests ---

    function test_executeTransfer_erc20_succeeds() public {
        _delegateAsUser(recipient, address(usdc), 1000e6, 30 days, 0);

        // Transfer USDC balance to user's EOA (which now has code)
        // The mock mint goes to the user address
        // user already has 10_000e6 from setUp

        vm.prank(agent);
        EchoDelegator(payable(user)).executeTransfer(recipient, address(usdc), 500e6);

        assertEq(usdc.balanceOf(recipient), 500e6);
        assertEq(usdc.balanceOf(user), 9_500e6);

        // Check spent tracking
        EchoDelegator.Permission memory perm = EchoDelegator(payable(user)).getPermission(recipient, address(usdc));
        assertEq(perm.spentThisCycle, 500e6);
    }

    function test_executeTransfer_eth_succeeds() public {
        _delegateAsUser(recipient, address(0), 1 ether, 30 days, 0);

        uint256 recipientBalBefore = recipient.balance;

        vm.prank(agent);
        EchoDelegator(payable(user)).executeTransfer(recipient, address(0), 0.5 ether);

        assertEq(recipient.balance, recipientBalBefore + 0.5 ether);
    }

    function test_executeTransfer_reverts_wrong_agent() public {
        _delegateAsUser(recipient, address(usdc), 1000e6, 30 days, 0);

        vm.prank(address(0xBAD));
        vm.expectRevert(EchoDelegator.Unauthorized.selector);
        EchoDelegator(payable(user)).executeTransfer(recipient, address(usdc), 100e6);
    }

    function test_executeTransfer_reverts_not_active() public {
        // No delegation set up
        vm.etch(user, address(delegator).code);

        vm.prank(agent);
        vm.expectRevert(EchoDelegator.PermissionNotActive.selector);
        EchoDelegator(payable(user)).executeTransfer(recipient, address(usdc), 100e6);
    }

    function test_executeTransfer_reverts_expired() public {
        uint256 expiresAt = block.timestamp + 1 hours;
        _delegateAsUser(recipient, address(usdc), 1000e6, 30 days, expiresAt);

        // Warp past expiry
        vm.warp(expiresAt + 1);

        vm.prank(agent);
        vm.expectRevert(EchoDelegator.PermissionExpired.selector);
        EchoDelegator(payable(user)).executeTransfer(recipient, address(usdc), 100e6);
    }

    function test_executeTransfer_reverts_cycle_budget_exceeded() public {
        _delegateAsUser(recipient, address(usdc), 1000e6, 30 days, 0);

        vm.prank(agent);
        vm.expectRevert(EchoDelegator.CycleBudgetExceeded.selector);
        EchoDelegator(payable(user)).executeTransfer(recipient, address(usdc), 1001e6);
    }

    function test_executeTransfer_cycle_budget_accumulates() public {
        _delegateAsUser(recipient, address(usdc), 1000e6, 30 days, 0);

        vm.prank(agent);
        EchoDelegator(payable(user)).executeTransfer(recipient, address(usdc), 600e6);

        // Second transfer that exceeds remaining budget
        vm.prank(agent);
        vm.expectRevert(EchoDelegator.CycleBudgetExceeded.selector);
        EchoDelegator(payable(user)).executeTransfer(recipient, address(usdc), 500e6);

        // But a smaller amount within budget succeeds
        vm.prank(agent);
        EchoDelegator(payable(user)).executeTransfer(recipient, address(usdc), 400e6);

        assertEq(usdc.balanceOf(recipient), 1000e6);
    }

    function test_executeTransfer_cycle_resets_after_period() public {
        _delegateAsUser(recipient, address(usdc), 1000e6, 30 days, 0);

        // Spend full budget
        vm.prank(agent);
        EchoDelegator(payable(user)).executeTransfer(recipient, address(usdc), 1000e6);

        // Can't spend more in same cycle
        vm.prank(agent);
        vm.expectRevert(EchoDelegator.CycleBudgetExceeded.selector);
        EchoDelegator(payable(user)).executeTransfer(recipient, address(usdc), 100e6);

        // Warp past cycle
        vm.warp(block.timestamp + 30 days + 1);

        // Budget resets
        vm.prank(agent);
        EchoDelegator(payable(user)).executeTransfer(recipient, address(usdc), 1000e6);

        assertEq(usdc.balanceOf(recipient), 2000e6);
    }

    // --- revoke() tests ---

    function test_revoke_prevents_execution() public {
        _delegateAsUser(recipient, address(usdc), 1000e6, 30 days, 0);

        // Revoke
        vm.prank(user);
        EchoDelegator(payable(user)).revoke(recipient, address(usdc));

        // Execution now fails
        vm.prank(agent);
        vm.expectRevert(EchoDelegator.PermissionNotActive.selector);
        EchoDelegator(payable(user)).executeTransfer(recipient, address(usdc), 100e6);
    }

    function test_revoke_only_owner() public {
        _delegateAsUser(recipient, address(usdc), 1000e6, 30 days, 0);

        vm.prank(address(0xBAD));
        vm.expectRevert(EchoDelegator.Unauthorized.selector);
        EchoDelegator(payable(user)).revoke(recipient, address(usdc));
    }

    // --- Multi-token tests ---

    function test_multiple_tokens_same_recipient() public {
        MockERC20 usdt = new MockERC20();
        usdt.mint(user, 5000e6);

        _delegateAsUser(recipient, address(usdc), 1000e6, 30 days, 0);

        // Set up second delegation for USDT
        vm.prank(user);
        EchoDelegator(payable(user)).delegate(agent, recipient, address(usdt), 500e6, 7 days, 0);

        // Execute both
        vm.prank(agent);
        EchoDelegator(payable(user)).executeTransfer(recipient, address(usdc), 200e6);

        vm.prank(agent);
        EchoDelegator(payable(user)).executeTransfer(recipient, address(usdt), 300e6);

        assertEq(usdc.balanceOf(recipient), 200e6);
        assertEq(usdt.balanceOf(recipient), 300e6);
    }

    function test_multiple_recipients() public {
        address recipient2 = address(0xDEAD);
        _delegateAsUser(recipient, address(usdc), 500e6, 30 days, 0);

        vm.prank(user);
        EchoDelegator(payable(user)).delegate(agent, recipient2, address(usdc), 500e6, 30 days, 0);

        vm.prank(agent);
        EchoDelegator(payable(user)).executeTransfer(recipient, address(usdc), 300e6);

        vm.prank(agent);
        EchoDelegator(payable(user)).executeTransfer(recipient2, address(usdc), 400e6);

        assertEq(usdc.balanceOf(recipient), 300e6);
        assertEq(usdc.balanceOf(recipient2), 400e6);
    }

    // --- No cycle limit test (cycleSeconds = 0) ---

    function test_no_cycle_limit() public {
        // cycleSeconds = 0 means no cycle reset — maxPerCycle is a total lifetime cap
        _delegateAsUser(recipient, address(usdc), 5000e6, 0, 0);

        vm.prank(agent);
        EchoDelegator(payable(user)).executeTransfer(recipient, address(usdc), 3000e6);

        // Warp far into the future
        vm.warp(block.timestamp + 365 days);

        // Still limited by total cap
        vm.prank(agent);
        EchoDelegator(payable(user)).executeTransfer(recipient, address(usdc), 2000e6);

        // Now exhausted
        vm.prank(agent);
        vm.expectRevert(EchoDelegator.CycleBudgetExceeded.selector);
        EchoDelegator(payable(user)).executeTransfer(recipient, address(usdc), 1);
    }
}
