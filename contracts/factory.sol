// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "./dca.sol";

contract DCAProxyFactory {
    address public dcaContractImplementation;
    mapping(address => address) public userProxies;

    event ProxyCreated(address indexed user, address proxyAddress);

    constructor(address _dcaContractImplementation) {
        dcaContractImplementation = _dcaContractImplementation;
    }

    function createProxy() external returns (address) {
        require(userProxies[msg.sender] == address(0), "Proxy already exists for this address");

        // Create a new proxy instance (using EIP-1167 minimal proxy pattern)
        bytes20 targetBytes = bytes20(dcaContractImplementation);
        address proxy;
        assembly {
            let clone := mload(0x40)
            mstore(clone, 0x3d602d80600a3d3981f3) // minimal proxy creation code
            mstore(add(clone, 0x14), targetBytes)
            mstore(add(clone, 0x28), 0x5af43d82803e903d91602b57fd5bf3)
            proxy := create(0, clone, 0x37)
        }

        require(proxy != address(0), "Proxy creation failed");
        userProxies[msg.sender] = proxy;
        
        emit ProxyCreated(msg.sender, proxy);
        return proxy;
    }

    function getProxy(address user) external view returns (address) {
        return userProxies[user];
    }

    function hasProxy(address user) external view returns (bool) {
        return userProxies[user] != address(0);
    }
}
