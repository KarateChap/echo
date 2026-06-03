// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Script, console} from "forge-std/Script.sol";
import {EchoDelegator} from "../src/EchoDelegator.sol";

contract DeployScript is Script {
    function run() public {
        vm.startBroadcast();

        EchoDelegator delegator = new EchoDelegator();
        console.log("EchoDelegator deployed at:", address(delegator));

        vm.stopBroadcast();
    }
}
