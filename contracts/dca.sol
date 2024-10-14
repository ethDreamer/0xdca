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
}

interface IAllowanceTarget {
    function executeCall(
        address payable target,
        uint256 value,
        bytes calldata data
    ) external payable returns (bytes memory);
}

contract DCAContract {
    address public owner;          // Cold wallet
    address public executor;       // Hot wallet
    address public allowanceTarget;  // 0x Allowance Target (AllowanceHolder)

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
        address _allowanceTarget,  // AllowanceHolder address
        uint256 _maxSwapAmount,
        uint256 _minSwapInterval
    ) {
        owner = msg.sender; // Cold wallet deploys the contract
        executor = _executor;
        allowanceTarget = _allowanceTarget;
        maxSwapAmount = _maxSwapAmount;
        minSwapInterval = _minSwapInterval;
    }

    // Allows the owner to update the executor
    function setExecutor(address _executor) external onlyOwner {
        executor = _executor;
    }

    // Allows the owner to update swap parameters
    function setSwapParameters(uint256 _maxSwapAmount, uint256 _minSwapInterval) external onlyOwner {
        maxSwapAmount = _maxSwapAmount;
        minSwapInterval = _minSwapInterval;
    }

    // Main function to execute the swap
    function executeSwap(
        address sellToken,
        address buyToken,
        uint256 sellAmount,
        uint256 minBuyAmount,
        bytes calldata swapData  // Contains the call data to pass to the 0x Exchange
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
        (bool success, bytes memory resultData) = IAllowanceTarget(allowanceTarget).executeCall(
            payable(address(0)), // no ETH transfer needed
            0,
            swapData
        );
        require(success, "Swap failed");

        // Optionally, parse resultData to verify buyAmount (if available)
        uint256 buyAmount = IERC20(buyToken).balanceOf(address(this));
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