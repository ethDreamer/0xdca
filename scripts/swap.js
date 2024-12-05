// swap.js
const { ethers } = require("hardhat");
const fs = require("fs");
require("dotenv").config();

async function main() {
  const quote = JSON.parse(fs.readFileSync("./scripts/data/old_contract_quote.json", "utf8"));
  const contractAddress = fs.readFileSync("./scripts/data/contractAddress.txt", "utf8").trim();
  const { OWNER_PRIVATE_KEY, EXECUTOR_PRIVATE_KEY } = process.env;

  const owner = new ethers.Wallet(OWNER_PRIVATE_KEY, ethers.provider);
  const executor = new ethers.Wallet(EXECUTOR_PRIVATE_KEY, ethers.provider);

  const sellToken = quote.sellToken;
  const buyToken = quote.buyToken;
  const allowanceTarget = quote.transaction.to;
  const sellAmount = quote.sellAmount;
  const minBuyAmount = quote.minBuyAmount;
  const swapData = quote.transaction.data;

  const feeData = await ethers.provider.getFeeData();

  // Approve the DCA contract to spend USDC
  const usdcOwner = await ethers.getContractAt("IERC20", sellToken, owner);
  await usdcOwner.approve(contractAddress, ethers.MaxUint256, {
    maxFeePerGas: feeData.maxFeePerGas,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
  });

  // Execute the swap
  const dca = await ethers.getContractAt("DCAContract", contractAddress, executor);
  await dca.executeSwap(allowanceTarget, swapData, {
    maxFeePerGas: feeData.maxFeePerGas,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
  });
  console.log(`Swap executed successfully.`);

  const executorEthBalance = await ethers.provider.getBalance(executor.address);
  console.log("Executor ETH Balance:", ethers.formatEther(executorEthBalance));

  // Check USDC balance of the owner
  const ownerUsdcBalance = await usdcOwner.balanceOf(owner.address);
  console.log("Owner USDC Balance:", ethers.formatUnits(ownerUsdcBalance, 6));

  // Check WETH balance of the owner
  const weth = await ethers.getContractAt("IERC20", quote.buyToken, owner);
  const ownerWethBalance = await weth.balanceOf(owner.address);
  console.log("Owner WETH Balance:", ethers.formatEther(ownerWethBalance));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
