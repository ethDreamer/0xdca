const { ethers } = require("hardhat");
const fs = require("fs");

// Load ABI from JSON file
function loadAbi(abiFile) {
  try {
    const data = fs.readFileSync(abiFile, "utf8");
    return JSON.parse(data);
  } catch (err) {
    console.error(`Error loading ABI file ${abiFile}: ${err}`);
    return [];
  }
}

// Get proxy contract instance
function getProxyContract(ethersProvider, address) {
  const abi = loadAbi("frontend/dca.json");
  return new ethers.Contract(address, abi, ethersProvider);
}

// Derive accounts from seed phrase
function deriveAccounts(seedPhraseFile, numAccounts = 20) {
  const seedPhrase = fs.readFileSync(seedPhraseFile, "utf8").trim();
  const accounts = [];
  for (let i = 0; i < numAccounts; i++) {
    const wallet = ethers.HDNodeWallet.fromPhrase(seedPhrase, "", `m/44'/60'/0'/0/${i}`);
    accounts.push(wallet);
  }
  return accounts;
}

describe("Swap Debugging Test", function () {
  let proxyContract, sellToken, buyToken, executorSigner, erc20Abi;
  const proxyAddress = "0x12B1c743Ab5de51f5Aa50dB01bDcAD005B72dc53";
  const executorAddress = "0x70e73426F7BEE25e854415974399f0e9F5dcc404"; // Replace with executor address
  const ownerAddress = "0x670cca46347c59b9bdcd7b0e0239b7b58efa0214";
  let customProvider = new ethers.JsonRpcProvider("http://localhost:1337");

  before(async function () {
    const accounts = deriveAccounts("backend/seed_phrase.txt"); // Adjust path as needed
    executorSigner = accounts.find((wallet) => wallet.address.toLowerCase() === executorAddress.toLowerCase());

    if (!executorSigner) {
      throw new Error(`Executor address ${executorAddress} not found in derived accounts.`);
    }
    executorSigner = executorSigner.connect(customProvider);

    console.log(`Executor derived: ${executorSigner.address}`);

    const executorBalance = await customProvider.getBalance(executorSigner.address);
    console.log(`Executor ETH Balance: ${ethers.formatEther(executorBalance)} ETH`);

    // Connect to the already-deployed proxy contract
    proxyContract = getProxyContract(customProvider, proxyAddress);

    // Load the sell and buy token addresses from the proxy
    const sellTokenAddress = await proxyContract.sellToken();
    const buyTokenAddress = await proxyContract.buyToken();

    // Connect to the token contracts
    erc20Abi = JSON.parse(fs.readFileSync("frontend/erc20.json", "utf8")); // Adjust path if needed
    sellToken = new ethers.Contract(sellTokenAddress, erc20Abi, customProvider);
    buyToken = new ethers.Contract(buyTokenAddress, erc20Abi, customProvider);
  });

  it("should execute the swap using the quote file", async function () {
    // Load the quote from the file
    const quote = JSON.parse(fs.readFileSync("backend/100usdc.quote", "utf8"));
    const allowanceTarget = quote.transaction.to;
    const swapData = quote.transaction.data;

    console.log("Allowance Target Address:", allowanceTarget);
    console.log("Swap Data Length:", swapData.length);
    console.log("Swap Data:", swapData);

    //try {
        // Check balances before the swap
        const sellBalanceBefore = await sellToken.balanceOf(ownerAddress);
        const buyBalanceBefore = await buyToken.balanceOf(ownerAddress);

        console.log(`Sell Token Balance (before): ${ethers.formatUnits(sellBalanceBefore, 6)}`);
        console.log(`Buy Token Balance (before): ${ethers.formatUnits(buyBalanceBefore, 18)}`);

        // Execute the swap using the derived executor signer
        const tx = await proxyContract.connect(executorSigner).executeSwap(allowanceTarget, swapData);
        const receipt = await tx.wait();

        console.log(`Transaction succeeded: ${receipt.transactionHash}`);
        console.log(`Gas used: ${receipt.gasUsed.toString()}`);

        // Check balances after the swap
        const sellBalanceAfter = await sellToken.balanceOf(ownerAddress);
        const buyBalanceAfter = await buyToken.balanceOf(ownerAddress);

        console.log(`Sell Token Balance (after): ${ethers.formatUnits(sellBalanceAfter, 6)}`);
        console.log(`Buy Token Balance (after): ${ethers.formatUnits(buyBalanceAfter, 18)}`);
    /*
    } catch (error) {
        // Log detailed error information
        console.error("Transaction failed:", error.reason || error.message);
        console.error("Transaction data:", error.transaction?.data || "N/A");
        console.error("Transaction response:", error.transaction || "N/A");

        // Log additional debug details
        console.log("Quote buyAmount:", quote.buyAmount);
        console.log("Quote minBuyAmount:", quote.minBuyAmount);
    }
    */
  });
});
