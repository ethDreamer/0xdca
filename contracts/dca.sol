// DCAContract.sol
pragma solidity ^0.8.0;

interface IERC20 {
    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) external returns (bool);

    function approve(address spender, uint256 amount) external returns (bool);

    function balanceOf(address account) external view returns (uint256);

    function transfer(address to, uint256 amount) external returns (bool);

    function allowance(address owner, address spender) external view returns (uint256);
}

contract DCAContract {
    address public owner; // Cold wallet
    address public executor; // Hot wallet

    address public sellToken;
    address public buyToken;
    address public uniswapQuoter;
    uint24 public uniswapPoolFee;

    uint256 public maxSwapAmount;
    uint256 public minSwapInterval;
    uint256 public lastSwapTime;

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyExecutor() {
        require(msg.sender == executor, "Not executor");
        _;
    }

    constructor(
        address _executor,
        address _sellToken,
        address _buyToken,
        address _uniswapQuoter,
        uint24 _uniswapPoolFee,
        uint256 _maxSwapAmount,
        uint256 _minSwapInterval
    ) {
        owner = msg.sender;
        executor = _executor;
        sellToken = _sellToken;
        buyToken = _buyToken;
        uniswapQuoter = _uniswapQuoter;
        uniswapPoolFee = _uniswapPoolFee;
        maxSwapAmount = _maxSwapAmount;
        minSwapInterval = _minSwapInterval;
    }

    // Allows the owner to update the executor
    function setExecutor(address _executor) external onlyOwner {
        executor = _executor;
    }

    // Allows the owner to update the sellToken and buyToken
    function setTokens(address _sellToken, address _buyToken, uint24 _uniswapPoolFee) external onlyOwner {
        sellToken = _sellToken;
        buyToken = _buyToken;
        uniswapPoolFee = _uniswapPoolFee;
    }

    // Public getter functions for the sellToken and buyToken
    function getSellToken() external view returns (address) {
        return sellToken;
    }

    function getBuyToken() external view returns (address) {
        return buyToken;
    }

    // Allows the owner to update swap parameters
    function setSwapParameters(uint256 _maxSwapAmount, uint256 _minSwapInterval) external onlyOwner {
        maxSwapAmount = _maxSwapAmount;
        minSwapInterval = _minSwapInterval;
    }

    function setQuoter(address _uniswapQuoter) external onlyOwner {
        uniswapQuoter = _uniswapQuoter;
    }

    function calculateMinBuyAmount(uint256 sellAmount) public view returns (uint256) {
        // TODO: use uniswap to calculate price
        return 0;
    }

    // Main function to execute the swap
    function executeSwap(
        address allowanceTarget,
        uint256 sellAmount,
        bytes calldata swapData // Contains the call data to pass to the 0x Exchange
    ) external onlyExecutor {
        require(block.timestamp >= lastSwapTime + minSwapInterval, "Swap interval not reached");
        require(sellAmount <= maxSwapAmount, "Sell amount exceeds max limit");

        lastSwapTime = block.timestamp;

        // Transfer tokens from the cold wallet to this contract
        require(
            IERC20(sellToken).transferFrom(owner, address(this), sellAmount),
            "TransferFrom failed"
        );

        // Approve the Allowance Target to spend tokens
        require(
            IERC20(sellToken).approve(allowanceTarget, sellAmount),
            "Approval to Allowance Target failed"
        );

        // Execute the swap using the 0x Allowance Target
        (bool success, bytes memory result) = allowanceTarget.call(swapData);
        require(success, "Swap failed");

        // Verify the amount bought
        uint256 buyAmount = IERC20(buyToken).balanceOf(address(this));
        uint256 minBuyAmount = calculateMinBuyAmount(sellAmount);
        require(buyAmount >= minBuyAmount, "Buy amount less than minimum");

        // Transfer the bought tokens back to the cold wallet
        require(
            IERC20(buyToken).transfer(owner, buyAmount),
            "Transfer to owner failed"
        );

        // Reset allowance to prevent reentrancy attacks
        require(
            IERC20(sellToken).approve(allowanceTarget, 0),
            "Reset approval failed"
        );
    }
}
