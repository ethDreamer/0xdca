// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/proxy/Clones.sol";
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
        uint256 _swapAmount,
        uint256 _swapInterval
    ) external returns (address) {
        require(userProxies[msg.sender] == address(0), "Proxy already exists for this address");

        address proxy = Clones.clone(dcaContractImplementation);

        // Initialize the proxy contract
        DCAContract(proxy).initialize(
            msg.sender,        // _owner
            _executor,         // _executor
            _sellToken,        // _sellToken
            _buyToken,         // _buyToken
            _uniswapQuoter,    // _uniswapQuoter
            _uniswapPoolFee,   // _uniswapPoolFee
            _swapAmount,       // _swapAmount
            _swapInterval,     // _swapInterval
            true
        );

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
