const { ethers } = require("hardhat");

async function main() {
  const owner = new ethers.Wallet(process.env.OWNER_PRIVATE_KEY, ethers.provider);
  console.log("Owner address:", owner.address);

  const feeData = await ethers.provider.getFeeData();
  console.log("Fee data:", feeData);

  const maxFeePerGas = feeData.maxFeePerGas || ethers.parseUnits("50", "gwei");
  const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas || ethers.parseUnits("2", "gwei");

  let nonce = await ethers.provider.getTransactionCount(owner.address);
  console.log("Starting nonce:", nonce);

  // Deploy the DCA contract
  console.log("Deploying DCAContract...");
  const DCAContract = await ethers.getContractFactory("DCAContract");
  const dcaDeployTx = await DCAContract.connect(owner).deploy({
    nonce,
    maxFeePerGas,
    maxPriorityFeePerGas,
    gasLimit: 3000000, // Adjust gas limit if necessary
  });
  nonce++;
  console.log(`DCAContract deployment tx hash: ${dcaDeployTx.hash}`);
  await dcaDeployTx.waitForDeployment();
  const dcaAddress = await dcaDeployTx.getAddress();
  console.log(`DCAContract deployed at: ${dcaAddress}`);

  // Initialize the DCA contract
  console.log("Initializing DCAContract...");
  const dcaInstance = await ethers.getContractAt("DCAContract", dcaAddress, owner);
  const initTx = await dcaInstance.initialize(
    owner.address,
    ethers.ZeroAddress,
    ethers.ZeroAddress,
    ethers.ZeroAddress,
    ethers.ZeroAddress,
    0,
    0,
    0,
    {
      nonce,
      maxFeePerGas,
      maxPriorityFeePerGas,
      gasLimit: 300000,
    }
  );
  nonce++;
  console.log(`DCAContract initialization tx hash: ${initTx.hash}`);
  await initTx.wait();
  console.log("DCAContract initialized.");

  // Deploy the Proxy Factory
  console.log("Deploying Proxy Factory...");
  const DCAProxyFactory = await ethers.getContractFactory("DCAProxyFactory");
  const proxyFactoryTx = await DCAProxyFactory.connect(owner).deploy(dcaAddress, {
    nonce,
    maxFeePerGas,
    maxPriorityFeePerGas,
    gasLimit: 3000000,
  });
  console.log(`Proxy Factory deployment tx hash: ${proxyFactoryTx.hash}`);
  await proxyFactoryTx.waitForDeployment();
  const proxyFactoryAddress = await proxyFactoryTx.getAddress();
  console.log(`Proxy Factory deployed at: ${proxyFactoryAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error deploying:", error);
    process.exit(1);
  });
