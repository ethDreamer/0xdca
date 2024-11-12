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

    function createProxy(
        address _executor,
        address _sellToken,
        address _buyToken,
        address _uniswapQuoter,
        uint24 _uniswapPoolFee,
        uint256 _maxSwapAmount,
        uint256 _minSwapInterval
    ) external returns (address) {
        require(userProxies[msg.sender] == address(0), "Proxy already exists for this address");

        bytes20 targetBytes = bytes20(dcaContractImplementation);
        address proxy;

        // EIP-1167 minimal proxy deployment
        assembly {
            let clone := mload(0x40)
            mstore(clone, 0x3d602d80600a3d3981f3)
            mstore(add(clone, 0x14), targetBytes)
            mstore(add(clone, 0x28), 0x5af43d82803e903d91602b57fd5bf3)
            proxy := create(0, clone, 0x37)
        }

        require(proxy != address(0), "Proxy creation failed");

        // Initialize the proxy contract
        (bool success, ) = proxy.call(
            abi.encodeWithSignature(
                "initialize(address,address,address,address,address,uint24,uint256,uint256)",
                msg.sender,        // _owner
                _executor,         // _executor
                _sellToken,        // _sellToken
                _buyToken,         // _buyToken
                _uniswapQuoter,    // _uniswapQuoter
                _uniswapPoolFee,   // _uniswapPoolFee
                _maxSwapAmount,    // _maxSwapAmount
                _minSwapInterval   // _minSwapInterval
            )
        );
        require(success, "Initialization failed");

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
