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

  const sellToken = new Token(chainId, sellTokenAddress, 6, "USDC", "USD Coin");
  const buyToken = new Token(chainId, buyTokenAddress, 18, "WETH", "Wrapped ETH");

  const poolFee = await allpools(chainId, sellToken, buyToken);
  console.log(`Most liquid pool fee: ${poolFee}`);

  await ethers.provider.send("hardhat_impersonateAccount", [USDC_HOLDER_ADDRESS]);
  const usdcHolder = await ethers.getSigner(USDC_HOLDER_ADDRESS);

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
  console.log(`DCAContract deployed at: ${dca.target}`);

  // Deploy the Proxy Factory with the DCA contract's address
  const DCAProxyFactory = await ethers.getContractFactory("DCAProxyFactory");
  const proxyFactory = await DCAProxyFactory.connect(owner).deploy(dca.target, {
    maxFeePerGas: feeData.maxFeePerGas,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
  });
  await proxyFactory.waitForDeployment();
  console.log(`DCAProxyFactory deployed at: ${proxyFactory.target}`);

  // Save the contract addresses for later use
  fs.writeFileSync("./scripts/data/contractAddress.txt", dca.target);
  fs.writeFileSync("./scripts/data/proxyFactoryAddress.txt", proxyFactory.target);

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
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
