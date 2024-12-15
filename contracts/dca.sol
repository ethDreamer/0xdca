// DCAContract.sol
pragma solidity ^0.8.4;
pragma abicoder v2; // Enable ABI coder v2
//import "hardhat/console.sol";

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

interface IQuoterV2 {
    struct QuoteExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint24 fee;
        uint160 sqrtPriceLimitX96;
    }

    function quoteExactInputSingle(QuoteExactInputSingleParams memory params)
        external
        returns (
            uint256 amountOut,
            uint160 sqrtPriceX96After,
            uint32 initializedTicksCrossed,
            uint256 gasEstimate
        );
}

contract DCAContract {
    address public owner;
    address public executor;

    address public sellToken;
    address public buyToken;
    address public uniswapQuoter;
    uint24 public uniswapPoolFee;

    uint256 public swapAmount;
    uint256 public swapInterval;
    uint256 public lastSwapTime;

    uint256 public minimumPrice;
    bool public doubleCheck;

    bool private initialized;

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyExecutor() {
        require(msg.sender == executor, "Not executor");
        _;
    }

    function initialize(
        address _owner,
        address _executor,
        address _sellToken,
        address _buyToken,
        address _uniswapQuoter,
        uint24 _uniswapPoolFee,
        uint256 _swapAmount,
        uint256 _swapInterval,
        bool _doubleCheck
    ) external {
        require(!initialized, "Already initialized");
        owner = _owner;
        executor = _executor;
        sellToken = _sellToken;
        buyToken = _buyToken;
        uniswapQuoter = _uniswapQuoter;
        uniswapPoolFee = _uniswapPoolFee;
        swapAmount = _swapAmount;
        swapInterval = _swapInterval;
        doubleCheck = _doubleCheck;
        initialized = true;
    }

    constructor() {
        owner = msg.sender;
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

    // Allows the owner to update swap parameters
    function setSwapParameters(uint256 _swapAmount, uint256 _swapInterval) external onlyOwner {
        swapAmount = _swapAmount;
        swapInterval = _swapInterval;
    }

    function setQuoter(address _uniswapQuoter) external onlyOwner {
        uniswapQuoter = _uniswapQuoter;
    }

    function getToleranceFactor() internal view returns (uint256) {
        if (uniswapPoolFee == 3000) {
            return 9800; // 2% tolerance
        } else if (uniswapPoolFee == 500) {
            return 9950; // 0.5% tolerance as a decimal (99.5%)
        } else if (uniswapPoolFee == 100) {
            return 9990; // 0.1% tolerance as a decimal (99.9%)
        } else {
            return 9900;
        }
    }

    // minimum price is scaled by 10^18 for precision
    function setMinimumPrice(uint256 _minimumPrice) external onlyOwner {
        minimumPrice = _minimumPrice;
    }

    // Set doubleCheck
    function setDoubleCheck(bool _doubleCheck) external onlyOwner {
        doubleCheck = _doubleCheck;
    }

    function calculateMinBuyAmount(uint256 sellAmount) internal returns (uint256) {
        IQuoterV2 quoter = IQuoterV2(uniswapQuoter);

        // Prepare the parameters for the quoter function
        IQuoterV2.QuoteExactInputSingleParams memory params = IQuoterV2.QuoteExactInputSingleParams({
            tokenIn: sellToken,
            tokenOut: buyToken,
            fee: uniswapPoolFee,
            amountIn: sellAmount,
            sqrtPriceLimitX96: 0  // No price limit
        });

        // Capture all returned values
        (uint256 amountOut, , , ) = quoter.quoteExactInputSingle(params);

        uint256 tolerance = getToleranceFactor();
        return amountOut * tolerance / 10000;
    }

    // Main function to execute the swap
    function executeSwap(
        address allowanceTarget,
        bytes calldata swapData // Contains the call data to pass to the 0x Exchange
    ) external onlyExecutor {
        require(block.timestamp >= lastSwapTime + swapInterval, "Swap interval not reached");

        lastSwapTime = block.timestamp;
        // Transfer tokens from the cold wallet to this contract
        require(
            IERC20(sellToken).transferFrom(owner, address(this), swapAmount),
            "TransferFrom failed"
        );

        // Approve the Allowance Target to spend tokens
        require(
            IERC20(sellToken).approve(allowanceTarget, swapAmount),
            "Approval to Allowance Target failed"
        );

        // Get owner balance of Buy Token before swap
        uint256 initialBalance = IERC20(buyToken).balanceOf(owner);

        // Execute the swap using the 0x Allowance Target
        (bool success, ) = allowanceTarget.call(swapData);
        require(success, "Swap failed");

        // Get owner balance of Buy Token after swap
        uint256 finalBalance = IERC20(buyToken).balanceOf(owner);

        uint256 amountBought = finalBalance - initialBalance;

        // Verify the amount bought
        if (minimumPrice > 0) {
            uint256 actualPrice = (amountBought * 1e18) / swapAmount;
            require(actualPrice >= minimumPrice, "Price below minimum");
        }
        if (doubleCheck) {
            uint256 minBuyAmount = calculateMinBuyAmount(swapAmount);
            require(amountBought >= minBuyAmount, "Buy amount less than minimum");
        }
    }
}
