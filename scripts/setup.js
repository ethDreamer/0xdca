// setup.js
const { ethers } = require("hardhat");
const fs = require("fs");
require("dotenv").config();

async function main() {
  const { OWNER_PRIVATE_KEY, EXECUTOR_PRIVATE_KEY, USDC_HOLDER_ADDRESS } = process.env;
  const owner = new ethers.Wallet(OWNER_PRIVATE_KEY, ethers.provider);
  const executor = new ethers.Wallet(EXECUTOR_PRIVATE_KEY, ethers.provider);

  const initialUSDCBalance = "100000";
  const feeData = await ethers.provider.getFeeData();

  // Impersonate the USDC holder account
  await ethers.provider.send("hardhat_impersonateAccount", [USDC_HOLDER_ADDRESS]);
  const usdcHolder = await ethers.getSigner(USDC_HOLDER_ADDRESS);

  // Transfer USDC to the owner
  const usdc = await ethers.getContractAt("IERC20", "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", usdcHolder);
  await usdc.connect(usdcHolder).transfer(owner.address, ethers.parseUnits(initialUSDCBalance, 6), {
    maxFeePerGas: feeData.maxFeePerGas,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
  });

  // Deploy the DCA contract
  const DCAContract = await ethers.getContractFactory("DCAContract");
  const maxSwapAmount = ethers.parseUnits("1000", 6);
  const minSwapInterval = 0;
  const dca = await DCAContract.connect(owner).deploy(
    executor.address,
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
