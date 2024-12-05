// setup.js
const { ethers } = require("hardhat");
const fs = require("fs");
require("dotenv").config();
const { Token } = require("@uniswap/sdk-core");
const { computePoolAddress } = require("@uniswap/v3-sdk");

async function allpools(chainId, sellToken, buyToken) {
  const { UNISWAP_FACTORY } = process.env;
  const IUniswapV3PoolABI = JSON.parse(fs.readFileSync("./abis/IUniswapV3Pool.json", "utf8"));

  let greatestLiquidity = 0;
  let bestPool = "";
  for (const poolFee of [3000, 500, 100]) {
    const poolAddress = computePoolAddress({
      factoryAddress: UNISWAP_FACTORY,
      tokenA: sellToken,
      tokenB: buyToken,
      fee: poolFee,
      chainId: chainId,
    });

    const pool = new ethers.Contract(poolAddress, IUniswapV3PoolABI, ethers.provider);
    const liquidity = await pool.liquidity();
    const liquidityInt = BigInt(liquidity.toString());
    if (liquidityInt > greatestLiquidity) {
      greatestLiquidity = liquidityInt;
      bestPool = poolFee;
    }

    console.log(`Pool Fee: ${poolFee}`);
    console.log(`Pool Address: ${poolAddress}`);
    console.log(`Pool Liquidity: ${liquidity.toString()}\n`);
  }

  return bestPool;
}

async function logBalances(address, usdc) {
  const ethBalance = await ethers.provider.getBalance(address);
  const usdcBalance = await usdc.balanceOf(address);
  console.log(`ETH Balance of ${address}:`, ethers.formatEther(ethBalance));
  console.log(`USDC Balance of ${address}:`, ethers.formatUnits(usdcBalance, 6));
}

async function main() {
  const {
    OWNER_PRIVATE_KEY,
    EXECUTOR_PRIVATE_KEY,
    USDC_HOLDER_ADDRESS,
    CHAIN_ID,
    BUY_TOKEN_ADDRESS,
    SELL_TOKEN_ADDRESS,
    UNISWAP_QUOTER,
  } = process.env;

  const owner = new ethers.Wallet(OWNER_PRIVATE_KEY, ethers.provider);
  const executor = new ethers.Wallet(EXECUTOR_PRIVATE_KEY, ethers.provider);

  const initialUSDCBalance = "100000";
  const feeData = await ethers.provider.getFeeData();

  const sellTokenAddress = SELL_TOKEN_ADDRESS;
  const buyTokenAddress = BUY_TOKEN_ADDRESS;
  const chainId = parseInt(CHAIN_ID);

  // Create Token instances for Uniswap SDK
  const sellToken = new Token(chainId, sellTokenAddress, 6, "USDC", "USD Coin");
  const buyToken = new Token(chainId, buyTokenAddress, 18, "WETH", "Wrapped ETH");

  // find the most liquid pool
  const poolFee = await allpools(chainId, sellToken, buyToken);
  console.log(`Most liquid pool fee: ${poolFee}`);

  // Impersonate the USDC holder account
  await ethers.provider.send("hardhat_impersonateAccount", [USDC_HOLDER_ADDRESS]);
  const usdcHolder = await ethers.getSigner(USDC_HOLDER_ADDRESS);

  // Transfer USDC to the owner
  const usdc = await ethers.getContractAt("IERC20", sellToken.address, usdcHolder);
  await usdc.connect(usdcHolder).transfer(owner.address, ethers.parseUnits(initialUSDCBalance, sellToken.decimals), {
    maxFeePerGas: feeData.maxFeePerGas,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
  });

  // Deploy the DCA contract (no constructor arguments needed)
  const DCAContract = await ethers.getContractFactory("DCAContract");
  const dca = await DCAContract.connect(owner).deploy({
    maxFeePerGas: feeData.maxFeePerGas,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
  });
  await dca.waitForDeployment();
  // Initialize the DCA contract
  dcaContract = dca.target;
  dcaInstance = await ethers.getContractAt("DCAContract", dcaContract, owner);
  await dcaInstance.connect(owner).initialize(
    owner.address,
    executor.address,
    sellToken.address,
    buyToken.address,
    UNISWAP_QUOTER,
    poolFee,
    ethers.parseUnits("1000", sellToken.decimals),
    0,
    {
      maxFeePerGas: feeData.maxFeePerGas,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
    }
  );
  console.log(`DCAContract deployed at: ${dcaContract}`);

  // Deploy the Proxy Factory with the DCA contract's address
  const DCAProxyFactory = await ethers.getContractFactory("DCAProxyFactory");
  const proxyFactory = await DCAProxyFactory.connect(owner).deploy(dcaContract, {
    maxFeePerGas: feeData.maxFeePerGas,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
  });
  await proxyFactory.waitForDeployment();
  console.log(`DCAProxyFactory deployed at: ${proxyFactory.target}`);

  // Save the contract addresses for later use
  fs.writeFileSync("./scripts/data/contractAddress.txt", dcaContract);
  fs.writeFileSync("./scripts/data/proxyFactoryAddress.txt", proxyFactory.target);

    // Deploy the proxy via the factory
    const sellAmount = ethers.parseUnits(process.env.SELL_UNITS_WHOLE || "1000", 6); // 1000 USDC with 6 decimals
    const uniswapQuoter = UNISWAP_QUOTER;
    const uniswapPoolFee = 3000; // Replace with actual value if necessary
    const swapInterval = 0; // For testing purposes

    const createProxyTx = await proxyFactory.createProxy(
        executor.address,
        sellTokenAddress,
        buyTokenAddress,
        uniswapQuoter,
        uniswapPoolFee,
        sellAmount,
        swapInterval,
        {
            maxFeePerGas: feeData.maxFeePerGas,
            maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
        }
    );
    const createProxyReceipt = await createProxyTx.wait();
    console.log(`Proxy deployed via factory, tx hash: ${createProxyReceipt.transactionHash}`);

    const proxyAddress = await proxyFactory.getProxy(owner.address);
    console.log(`Proxy address: ${proxyAddress}`);

    // save proxy address
    fs.writeFileSync("./scripts/data/proxyAddress.txt", proxyAddress);

    const usdcContract = await ethers.getContractAt("IERC20", sellToken.address, owner);

    // Approve the proxy to spend USDC from owner
    const approveTx = await usdcContract.approve(proxyAddress, ethers.MaxUint256, {
        maxFeePerGas: feeData.maxFeePerGas,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
    });
    await approveTx.wait();
    console.log(`Approved USDC for proxy: ${proxyAddress}`);

    // Check allowance
    const usdcAllowance = await usdcContract.allowance(owner.address, proxyAddress);
    console.log(`Owner's USDC allowance to proxy: ${usdcAllowance.toString()}`);


  // Log balances before and after transfer
    const testing_address = "0x670CCA46347c59B9BDcD7B0E0239B7B58eFA0214";
    console.log("Balances before transfer to testing address:");
    await logBalances(testing_address, usdc);

  // Send 5 ETH and 10,000 USDC to testing address
  await owner.sendTransaction({
    to: testing_address,
    value: ethers.parseEther("5"),
  }).then(tx => tx.wait());
  await usdc.connect(owner).transfer(testing_address, ethers.parseUnits("10000", sellToken.decimals)).then(tx => tx.wait());

  console.log("Balances after transfer to testing address:");
  await logBalances(testing_address, usdc);

  await network.provider.send("evm_setIntervalMining", [5000]);

  await ethers.provider.send("hardhat_stopImpersonatingAccount", [USDC_HOLDER_ADDRESS]);

  second_executor = "0x70e73426f7bee25e854415974399f0e9f5dcc404";
  // send 1 ETH to second executor
  await owner.sendTransaction({
    to: second_executor,
    value: ethers.parseEther("1"),
  }).then(tx => tx.wait());

}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
