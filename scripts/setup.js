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
    USDC_HOLDER_ADDRESS,
    CHAIN_ID,
    BUY_TOKEN_ADDRESS,
    SELL_TOKEN_ADDRESS,
    TESTING_ADDRESS,
  } = process.env;

  const trader = new ethers.Wallet(OWNER_PRIVATE_KEY, ethers.provider);
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

  // Transfer funds to testing address
  const testing_address = TESTING_ADDRESS;

  // Transfer USDC to testing address
  const usdc = await ethers.getContractAt("IERC20", sellToken.address, usdcHolder);
  await usdc.connect(usdcHolder).transfer(testing_address, ethers.parseUnits(initialUSDCBalance, sellToken.decimals), {
    maxFeePerGas: feeData.maxFeePerGas,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
  });

  // Send 5 ETH to testing address
  await trader.sendTransaction({
    to: testing_address,
    value: ethers.parseEther("5"),
  }).then(tx => tx.wait());
  await usdc.connect(usdcHolder).transfer(testing_address, ethers.parseUnits("10000", sellToken.decimals)).then(tx => tx.wait());

  console.log("Balances after transfer to testing address:");
  await logBalances(testing_address, usdc);

  await network.provider.send("evm_setIntervalMining", [5000]);
  await ethers.provider.send("hardhat_stopImpersonatingAccount", [USDC_HOLDER_ADDRESS]);

  second_executor = "0x70e73426f7bee25e854415974399f0e9f5dcc404";
  // send 1 ETH to second executor
  await trader.sendTransaction({
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
