// setup.js
const { ethers } = require("hardhat");
const fs = require("fs");
require("dotenv").config();
const { Token } = require("@uniswap/sdk-core");
const { computePoolAddress } = require("@uniswap/v3-sdk");

async function allpools(chainId, sellToken, buyToken) {
  const { UNISWAP_FACTORY } = process.env;
  // load uniswapv3pool abi
  const IUniswapV3PoolABI = JSON.parse(fs.readFileSync("./abis/IUniswapV3Pool.json", "utf8"));

  // Loop through each pool fee of 3000, 500, 100 basis points
  var greatestLiquidity = 0;
  var bestPool = "";
  for (const poolFee of [3000, 500, 100]) {
    const poolAddress = computePoolAddress({
      factoryAddress: UNISWAP_FACTORY,
      tokenA: sellToken,
      tokenB: buyToken,
      fee: poolFee,
      chainId: chainId,
    });

    // Initialize the pool contract instance with ABI and address
    const pool = new ethers.Contract(poolAddress, IUniswapV3PoolABI, ethers.provider);

    // Get liquidity from the pool contract
    const liquidity = await pool.liquidity();
    let liquidityInt = BigInt(liquidity.toString());
    if (liquidityInt > greatestLiquidity) {
      greatestLiquidity = liquidityInt;
      bestPool = poolAddress;
    }

    // Print out pool information
    console.log(`Pool Fee: ${poolFee}`);
    console.log(`Pool Address: ${poolAddress}`);
    console.log(`Pool Liquidity: ${liquidity.toString()}\n`);
  }

  return bestPool;
}

async function main() {
  const { OWNER_PRIVATE_KEY, EXECUTOR_PRIVATE_KEY, USDC_HOLDER_ADDRESS, CHAIN_ID } = process.env;
  const owner = new ethers.Wallet(OWNER_PRIVATE_KEY, ethers.provider);
  const executor = new ethers.Wallet(EXECUTOR_PRIVATE_KEY, ethers.provider);

  const initialUSDCBalance = "100000";
  const feeData = await ethers.provider.getFeeData();

  const sellTokenAddress = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"; // USDC
  const buyTokenAddress = "0x4200000000000000000000000000000000000006"; // WETH
  const chainId = parseInt(CHAIN_ID);

  // Create Token instances for Uniswap SDK
  const sellToken = new Token(chainId, sellTokenAddress, 6, "USDC", "USD Coin");
  const buyToken = new Token(chainId, buyTokenAddress, 18, "WETH", "Wrapped ETH");

  // find the most liquid pool
  const poolAddress = await allpools(chainId, sellToken, buyToken);
  console.log(`Most liquid pool address: ${poolAddress}`);

  // Impersonate the USDC holder account
  await ethers.provider.send("hardhat_impersonateAccount", [USDC_HOLDER_ADDRESS]);
  const usdcHolder = await ethers.getSigner(USDC_HOLDER_ADDRESS);

  // Transfer USDC to the owner
  const usdc = await ethers.getContractAt("IERC20", sellToken.address, usdcHolder);
  await usdc.connect(usdcHolder).transfer(owner.address, ethers.parseUnits(initialUSDCBalance, sellToken.decimals), {
    maxFeePerGas: feeData.maxFeePerGas,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
  });

  // Deploy the DCA contract with the calculated pool address
  const DCAContract = await ethers.getContractFactory("DCAContract");
  const maxSwapAmount = ethers.parseUnits("1000", sellToken.decimals);
  const minSwapInterval = 0;
  const dca = await DCAContract.connect(owner).deploy(
    executor.address,
    sellToken.address,
    buyToken.address,
    poolAddress,
    maxSwapAmount,
    minSwapInterval,
    {
      maxFeePerGas: feeData.maxFeePerGas,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
    }
  );
  await dca.waitForDeployment();
  console.log(`DCAContract deployed at: ${dca.target}`);

  // Save the contract address for the swap script
  fs.writeFileSync("./scripts/data/contractAddress.txt", dca.target);

  await ethers.provider.send("hardhat_stopImpersonatingAccount", [USDC_HOLDER_ADDRESS]);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
