const { expect } = require("chai");
const fs = require("fs");
require("hardhat-tracer");
const { Interface } = require("ethers");
const { Token } = require("@uniswap/sdk-core");
const { computePoolAddress } = require("@uniswap/v3-sdk");

describe("DCAContract", function () {
  let owner, executor, usdcHolder, usdc, dca;
  let sellToken, buyToken, allowanceTarget, sellAmount, minBuyAmount, swapData;
  
  before(async function () {
    await hre.network.provider.request({
        method: "hardhat_reset",
        params: [{
          forking: {
            jsonRpcUrl: `https://base-mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`,
            blockNumber: 21062365,
          }
        }]
      });

    const quote = JSON.parse(fs.readFileSync("./scripts/data/0xquote.json", "utf8"));
    sellToken = quote.sellToken;
    buyToken = quote.buyToken;
    allowanceTarget = quote.transaction.to;
    sellAmount = quote.sellAmount;
    minBuyAmount = quote.minBuyAmount;
    swapData = quote.transaction.data;

    [owner, executor] = await ethers.getSigners();

    await ethers.provider.send("hardhat_impersonateAccount", [process.env.USDC_HOLDER_ADDRESS]);
    usdcHolder = await ethers.getSigner(process.env.USDC_HOLDER_ADDRESS);

    usdc = await ethers.getContractAt("IERC20", sellToken, usdcHolder);
    const initialUSDCBalance = ethers.parseUnits("100000", 6);
    await usdc.connect(usdcHolder).transfer(owner.address, initialUSDCBalance);
  });

  async function allpools(chainId, sellTokenAddr, buyTokenAddr) {
    const { UNISWAP_FACTORY } = process.env;
    const sellToken = new Token(chainId, sellTokenAddr, 6, "USDC", "USD Coin");
    const buyToken = new Token(chainId, buyTokenAddr, 18, "WETH", "Wrapped ETH");

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
        bestPool = poolFee;
      }

      // Print out pool information
      console.log(`Pool Fee: ${poolFee}`);
      console.log(`Pool Address: ${poolAddress}`);
      console.log(`Pool Liquidity: ${liquidity.toString()}\n`);
    }

    return bestPool;
  }

  it("should deploy and execute swap on DCAContract", async function () {
    // Deploy the DCA contract from the owner
    const DCAContract = await ethers.getContractFactory("DCAContract");
    const maxSwapAmount = ethers.parseUnits("1000", 6);
    const minSwapInterval = 30;
    const poolFee = await allpools(1, sellToken, buyToken);

    const dca = await DCAContract.connect(owner).deploy(
        executor.address,
        sellToken,
        buyToken,
        process.env.UNISWAP_QUOTER,
        poolFee,
        maxSwapAmount,
        minSwapInterval
    );
    await dca.waitForDeployment();

    console.log(`Deployed DCAContract at address: ${dca.target}`);
    console.log(`Allowance target: ${allowanceTarget}`);

    // Approve the DCA contract to spend USDC on behalf of owner
    const usdcOwner = await ethers.getContractAt("IERC20", sellToken, owner);
    await usdcOwner.approve(dca.target, ethers.MaxUint256);

    const usdcBalance = await usdcOwner.balanceOf(owner.address);
    const usdcAllowance = await usdcOwner.allowance(owner.address, dca.target);

    console.log(`Owner USDC Balance: ${usdcBalance.toString()}`);
    console.log(`USDC Allowance for DCA Contract: ${usdcAllowance.toString()}`);

    expect(usdcAllowance).to.equal(ethers.MaxUint256);
    console.log("allowance correct");

    console.log("Executing swap with parameters:");
    console.log("Sell Token:", sellToken);
    console.log("Buy Token:", buyToken);
    console.log("Sell Amount:", sellAmount);
    console.log("Min Buy Amount:", minBuyAmount);
    console.log("AllowanceTarget:", allowanceTarget);
    console.log("Swap Data:", swapData);

    const txResponse = await dca.connect(executor).executeSwap(allowanceTarget, sellAmount, swapData);
    const txReceipt = await txResponse.wait();

    // Verify transaction completion
    expect(txReceipt.status).to.equal(1);
    console.log(`Swap executed successfully. Transaction included in block ${txReceipt.blockNumber}.`);
  });

  after(async function () {
    await ethers.provider.send("hardhat_stopImpersonatingAccount", [process.env.USDC_HOLDER_ADDRESS]);
  });
});
