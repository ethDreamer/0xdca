// scripts/setup.js
const { ethers } = require("hardhat");
const fs = require("fs");
require("dotenv").config();

async function main() {
  const quote = JSON.parse(fs.readFileSync("./scripts/data/0xquote.json", "utf8"));
  const { OWNER_PRIVATE_KEY, EXECUTOR_PRIVATE_KEY, USDC_HOLDER_ADDRESS } = process.env;

  // Create Wallet instances for owner and executor using ethers
  const owner = new ethers.Wallet(OWNER_PRIVATE_KEY, ethers.provider);
  const executor = new ethers.Wallet(EXECUTOR_PRIVATE_KEY, ethers.provider);

  // Token details from the saved quote
  const sellToken = quote.sellToken;
  const allowanceTarget = quote.transaction.to;
  const buyToken = quote.buyToken;
  const sellAmount = quote.sellAmount;
  const minBuyAmount = quote.minBuyAmount;
  const swapData = quote.transaction.data;

  const initialUSDCBalance = "100000";

  // Impersonate the USDC holder account
  await ethers.provider.send("hardhat_impersonateAccount", [USDC_HOLDER_ADDRESS]);
  const usdcHolder = await ethers.getSigner(USDC_HOLDER_ADDRESS);

  // Fetch USDC contract instance connected to usdcHolder
  const usdc = await ethers.getContractAt("IERC20", sellToken, usdcHolder);

  // Transfer USDC from the impersonated account to the owner
  await usdc.connect(usdcHolder).transfer(owner.address, ethers.parseUnits(initialUSDCBalance, 6));
  console.log(`Transferred ${initialUSDCBalance} USDC to owner address from ${USDC_HOLDER_ADDRESS}`);

  // Deploy the DCA contract from the owner
  const DCAContract = await ethers.getContractFactory("DCAContract");
  const maxSwapAmount = ethers.parseUnits("1000", 6);
  const minSwapInterval = 30;
  const dca = await DCAContract.connect(owner).deploy(
    executor.address,
    allowanceTarget,
    maxSwapAmount,
    minSwapInterval
  );
  await dca.waitForDeployment();
  console.log(`DCAContract deployed at: ${dca.target}`);

  // Approve the DCA contract to spend USDC on behalf of owner
  const usdcOwner = await ethers.getContractAt("IERC20", sellToken, owner);
  await usdcOwner.approve(dca.target, ethers.MaxUint256);

  const usdcBalance = await usdcOwner.balanceOf(owner.address);
  const usdcAllowance = await usdcOwner.allowance(owner.address, dca.target);

  console.log(`Owner USDC Balance: ${usdcBalance.toString()}`);
  console.log(`USDC Allowance for DCA Contract: ${usdcAllowance.toString()}`);

  // Execute the swap with calldata from 0xquote.json
  await dca.connect(executor).executeSwap(sellToken, buyToken, sellAmount, minBuyAmount, swapData);
  console.log(`Swap executed successfully.`);

  // Stop impersonating the USDC holder
  await ethers.provider.send("hardhat_stopImpersonatingAccount", [USDC_HOLDER_ADDRESS]);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
