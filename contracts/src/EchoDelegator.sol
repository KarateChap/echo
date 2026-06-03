// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IERC20} from "./interfaces/IERC20.sol";

/// @title EchoDelegator
/// @notice EIP-7702 delegator contract for Echo voice remittance.
///         Users sign an EIP-7702 authorization to set this contract's code on their EOA.
///         The contract enforces per-recipient, per-token spending limits with cycle budgets.
///         An authorized agent key can call executeTransfer() to spend from the user's EOA.
contract EchoDelegator {
    struct Permission {
        address agent;
        uint256 maxPerCycle;
        uint256 cycleSeconds;
        uint256 expiresAt; // 0 = no expiry
        uint256 cycleStart;
        uint256 spentThisCycle;
        bool active;
    }

    // recipient => tokenAddress => Permission
    // Storage is per-user via EIP-7702 (code runs in user's EOA context)
    mapping(address => mapping(address => Permission)) public permissions;

    event Delegated(
        address indexed recipient,
        address indexed tokenAddress,
        address agent,
        uint256 maxPerCycle,
        uint256 cycleSeconds,
        uint256 expiresAt
    );

    event Transferred(
        address indexed recipient,
        address indexed tokenAddress,
        uint256 amount
    );

    event Revoked(address indexed recipient, address indexed tokenAddress);

    error Unauthorized();
    error PermissionNotActive();
    error PermissionExpired();
    error CycleBudgetExceeded();
    error TransferFailed();
    error InvalidAgent();
    error InvalidMaxPerCycle();

    /// @notice Register a delegation permission. Called by the user in their EOA context.
    /// @dev msg.sender must equal address(this) — only the EOA owner can delegate.
    function delegate(
        address agent,
        address recipient,
        address tokenAddress,
        uint256 maxPerCycle,
        uint256 cycleSeconds,
        uint256 expiresAt
    ) external {
        if (msg.sender != address(this)) revert Unauthorized();
        if (agent == address(0)) revert InvalidAgent();
        if (maxPerCycle == 0) revert InvalidMaxPerCycle();

        permissions[recipient][tokenAddress] = Permission({
            agent: agent,
            maxPerCycle: maxPerCycle,
            cycleSeconds: cycleSeconds,
            expiresAt: expiresAt,
            cycleStart: block.timestamp,
            spentThisCycle: 0,
            active: true
        });

        emit Delegated(recipient, tokenAddress, agent, maxPerCycle, cycleSeconds, expiresAt);
    }

    /// @notice Execute a transfer on behalf of the user. Called by the authorized agent.
    /// @dev The agent sends this tx to the user's EOA address (which has delegated to this contract).
    function executeTransfer(
        address recipient,
        address tokenAddress,
        uint256 amount
    ) external {
        Permission storage perm = permissions[recipient][tokenAddress];

        if (!perm.active) revert PermissionNotActive();
        if (msg.sender != perm.agent) revert Unauthorized();
        if (perm.expiresAt != 0 && block.timestamp >= perm.expiresAt) revert PermissionExpired();

        // Reset cycle if elapsed
        if (perm.cycleSeconds > 0 && block.timestamp >= perm.cycleStart + perm.cycleSeconds) {
            perm.cycleStart = block.timestamp;
            perm.spentThisCycle = 0;
        }

        // Check cycle budget
        if (perm.spentThisCycle + amount > perm.maxPerCycle) revert CycleBudgetExceeded();

        perm.spentThisCycle += amount;

        // Execute the transfer from user's EOA context
        if (tokenAddress == address(0)) {
            // Native ETH
            (bool ok,) = recipient.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            // ERC-20 — transfer() with msg.sender = this EOA (user's account)
            bool ok = IERC20(tokenAddress).transfer(recipient, amount);
            if (!ok) revert TransferFailed();
        }

        emit Transferred(recipient, tokenAddress, amount);
    }

    /// @notice Revoke a delegation. Only the EOA owner can revoke.
    function revoke(address recipient, address tokenAddress) external {
        if (msg.sender != address(this)) revert Unauthorized();
        permissions[recipient][tokenAddress].active = false;
        emit Revoked(recipient, tokenAddress);
    }

    /// @notice View a permission's details.
    function getPermission(
        address recipient,
        address tokenAddress
    ) external view returns (Permission memory) {
        return permissions[recipient][tokenAddress];
    }

    /// @notice Allow the EOA to receive ETH (needed for refunds, etc.)
    receive() external payable {}
}
