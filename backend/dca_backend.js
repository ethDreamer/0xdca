#!/usr/bin/env node

const fs = require('fs');
const ethers = require('ethers');
const axios = require('axios');
require('dotenv').config();
const { exit } = require('process');

// Configure logging
const winston = require('winston');
const { format } = winston;
const { combine, timestamp, printf } = format;

const logger = winston.createLogger({
  level: 'info',
  format: combine(
    timestamp(),
    printf(({ level, message, timestamp }) => {
      return `${timestamp} ${level}: ${message}`;
    })
  ),
  transports: [new winston.transports.Console()],
});

// Global variable to store known account objects
let knownAccountObjects = [];

// Load configurations
function loadConfig(configFile) {
  try {
    const data = fs.readFileSync(configFile, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    logger.error(`Error loading config file ${configFile}: ${err}`);
    return {};
  }
}

// Load networks configuration
function loadNetworks(networksFile) {
  try {
    const data = fs.readFileSync(networksFile, 'utf8');
    return JSON.parse(data)['networks'];
  } catch (err) {
    logger.error(`Error loading networks file ${networksFile}: ${err}`);
    return {};
  }
}

function readAccountsSecurely(seedPhraseFile, numAccounts) {
  try {
    // Load and clean the seed phrase
    const seedPhrase = fs.readFileSync(seedPhraseFile, 'utf8').trim();

    let accounts = new Set();
    knownAccountObjects = [];

    for (let i = 0; i < numAccounts; i++) {
      // Derive child accounts directly
      let path = ethers.getIndexedAccountPath(i);
      let account = ethers.HDNodeWallet.fromPhrase(seedPhrase, "", path);
      accounts.add(account.address.toLowerCase());
      knownAccountObjects.push(account);
    }

    return accounts;
  } catch (err) {
    logger.error(`Error reading accounts from seed phrase file ${seedPhraseFile}: ${err}`);
    return new Set();
  }
}

// Get proxy factory address from networks configuration
function getProxyFactoryAddress(networkId, networksConfig) {
  const networkData = networksConfig[networkId];
  if (!networkData) {
    logger.error(`Network ID ${networkId} not found in networks configuration.`);
    return null;
  }
  return networkData['proxyFactoryAddress'];
}

// Verify if swap interval has passed
async function verifyInterval(ethersProvider, lastSwap, swapInterval) {
    try {
      // Fetch the latest block
      const latestBlock = await ethersProvider.getBlock("latest");
  
      // Extract the timestamp from the latest block
      const currentTime = BigInt(latestBlock.timestamp);
      // log current time
      logger.info(`Current Time: ${currentTime}`);
  
      if (currentTime >= lastSwap + swapInterval) {
        return true;
      } else {
        const timeLeft = lastSwap + swapInterval - currentTime;
        logger.info(
          `Swap interval not yet reached. Next swap in ${timeLeft.toString()} seconds.`
        );
        return false;
      }
    } catch (error) {
      logger.error(`Failed to fetch the latest block timestamp: ${error.message}`);
      return false;
    }
  }
  

// Verify if proxy has sufficient allowance
async function verifyAllowance(ethersProvider, sellTokenAddress, ownerAddress, spenderAddress, amount) {
  const erc20Abi = loadAbi('../docs/erc20.json');
  const erc20Contract = new ethers.Contract(sellTokenAddress, erc20Abi, ethersProvider);
  const allowance = await erc20Contract.allowance(ownerAddress, spenderAddress);
  if (allowance >= amount) {
    return true;
  } else {
    logger.info(`Insufficient allowance: ${allowance.toString()}, required: ${amount.toString()}`);
    return false;
  }
}

async function verifyScaledMinimumPrice(proxyContract, swapQuote, swapAmount) {
    try {
      // Fetch the minimum price from the contract
      const minimumPrice = await proxyContract.minimumPrice();
      if (minimumPrice === 0) {
        logger.info("No minimum price set; skipping price check.");
        return true; // No restriction
      }

      // Extract the buyAmount from the swap quote
      const buyAmount = BigInt(swapQuote.buyAmount);

      // Calculate the scaled minimum buy amount
      const scaledMinimumBuyAmount = (BigInt(swapAmount) * BigInt(minimumPrice)) / BigInt(1e18);

      logger.info(`Scaled Minimum Buy Amount: ${scaledMinimumBuyAmount.toString()}`);
      logger.info(`Buy Amount from Quote: ${buyAmount.toString()}`);

      // Check if the buy amount satisfies the scaled minimum price
      if (buyAmount >= scaledMinimumBuyAmount) {
        return true; // Swap is valid
      } else {
        logger.warn("Buy amount does not meet the scaled minimum price.");
        return false; // Swap is invalid
      }
    } catch (error) {
      logger.error(`Error verifying scaled minimum price: ${error.message}`);
      return false;
    }
}

// Get swap quote from 0x API
async function get0xQuote(
  buyToken,
  sellToken,
  amount,
  chainId,
  takerAddress,
  txOriginAddress,
  slippageBps = 50
) {
  /*
  // For testing, you can read from a local file
  try {
    //const data = fs.readFileSync('../scripts/data/new_contract_quote.json', 'utf8');
    const data = fs.readFileSync('./100usdc.quote', 'utf8')
    return JSON.parse(data);
  } catch (err) {
    logger.error('Failed to read quote from file:', err);
  }
  */

  // Load the ZERO_EX_API_KEY from environment variables
  const ZERO_EX_API_KEY = process.env.ZERO_EX_API_KEY;
  if (!ZERO_EX_API_KEY) {
    logger.error('ZERO_EX_API_KEY not set in environment variables.');
    return null;
  }

  const apiUrl = `https://api.0x.org/swap/allowance-holder/quote`;
  const params = {
    buyToken: buyToken,
    sellToken: sellToken,
    sellAmount: amount.toString(),
    chainId: chainId,
    taker: takerAddress,
    txOrigin: txOriginAddress,
    slippageBps: slippageBps.toString(),
  };
  const headers = {
    'Content-Type': 'application/json',
    '0x-api-key': ZERO_EX_API_KEY,
    '0x-version': 'v2',
  };
  try {
    const response = await axios.get(apiUrl, { params: params, headers: headers });
    return response.data;
  } catch (error) {
    logger.error(
      'Failed to get quote from 0x API:',
      error.response ? error.response.data : error
    );
    return null;
  }
}

// Get account object from address
function getAccountFromAddress(address) {
  for (const account of knownAccountObjects) {
    if (account.address.toLowerCase() === address.toLowerCase()) {
      return account;
    }
  }
  logger.error(`Executor account not found for address ${address}`);
  return null;
}

// Get proxy factory contract instance
function getProxyFactoryContract(ethersProvider, address) {
  const abi = loadAbi('../docs/factory.json');
  return new ethers.Contract(address, abi, ethersProvider);
}

// Get proxy contract instance
function getProxyContract(ethersProvider, address) {
  const abi = loadAbi('../docs/dca.json');
  return new ethers.Contract(address, abi, ethersProvider);
}

// Load ABI from JSON file
function loadAbi(abiFile) {
  try {
    const data = fs.readFileSync(abiFile, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    logger.error(`Error loading ABI file ${abiFile}: ${err}`);
    return [];
  }
}

// Execute swap on the proxy contract
async function executeSwap(proxyContract, executorAccount, swapQuote) {
    try {
        // Extract necessary fields from swapQuote
        const allowanceTarget = swapQuote.transaction.to;
        const sellAmount = BigInt(swapQuote.sellAmount);
        const transactionData = swapQuote.transaction.data;

        // Log relevant details for debugging
        logger.info(`Allowance Target: ${allowanceTarget}`);
        logger.info(`Sell Amount: ${sellAmount}`);
        logger.info(`Executor Address: ${executorAccount.address}`);

        // Fetch gas fee data using executorAccount's provider
        const feeData = await executorAccount.provider.getFeeData();

        // Log fee data for debugging
        logger.info(`Fee Data: maxFeePerGas=${feeData.maxFeePerGas}, maxPriorityFeePerGas=${feeData.maxPriorityFeePerGas}`);

        // Call executeSwap on the proxy contract with the executor account
        const proxyContractWithExecutor = proxyContract.connect(executorAccount);

        // Execute the transaction
        const txResponse = await proxyContractWithExecutor.executeSwap(
            allowanceTarget,
            transactionData,
            {
                maxFeePerGas: feeData.maxFeePerGas,
                maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
            }
        );

        // Wait for the transaction to be mined
        const txReceipt = await txResponse.wait();

        // Calculate gas fee
        const gasUsed = txReceipt.gasUsed;
        let effectiveGasPrice = txReceipt.effectiveGasPrice;
        if (!effectiveGasPrice) {
            effectiveGasPrice = txResponse.gasPrice || txResponse.maxFeePerGas || feeData.gasPrice || feeData.maxFeePerGas;
            if (!effectiveGasPrice) {
                logger.error("Effective Gas Price is undefined. Unable to calculate gas fee.");
                return null;
            }
        }

        // dump the tx receipt
        console.log(`Tx Receipt: ${txReceipt}`);
        console.log(`Gas Used type: ${typeof gasUsed}`);
        console.log(`Effective Gas Price type: ${typeof effectiveGasPrice}`);

        const gasFeePaid = gasUsed * effectiveGasPrice;

        // Log gas fee and transaction hash
        logger.info(`Swap executed via proxy. Tx hash: ${txResponse.hash}`);
        logger.info(`Gas Used: ${gasUsed.toString()}, Effective Gas Price: ${ethers.formatUnits(effectiveGasPrice, 'gwei')} Gwei`);
        logger.info(`Gas Fee Paid: ${ethers.formatEther(gasFeePaid)} ETH`);

        return txResponse.hash;
    } catch (e) {
        // Log the error and return null
        logger.error(`Error executing swap: ${e.message}`);
        return null;
    }
}

async function logTokenBalances(address, sellToken, buyToken) {
  const sellBalance = await sellToken.balanceOf(address);
  const buyBalance = await buyToken.balanceOf(address);

  const sellSymbol = await sellToken.symbol();
  const sellDecimals = await sellToken.decimals();
  const buySymbol = await buyToken.symbol();
  const buyDecimals = await buyToken.decimals();

  logger.info(`Address: ${address}`);
  logger.info(`Sell Token (${sellSymbol}): ${ethers.formatUnits(sellBalance, sellDecimals)}`);
  logger.info(`Buy Token (${buySymbol}): ${ethers.formatUnits(buyBalance, buyDecimals)}`);
}

// Main execution loop
async function main() {
  // Load configurations
  const config = loadConfig('./config.json');
  const networksConfig = loadNetworks('../docs/networks.json');
  const knownAccounts = readAccountsSecurely('./seed_phrase.txt', 20);
  for (const account of knownAccounts) {
    logger.info(`Known account: ${account}`);
  }

  while (true) {
    logger.info('Starting new iteration...');
    // No sleep at the beginning to run immediately on start
    for (const executorAddress in config.executors) {
      if (!knownAccounts.has(executorAddress.toLowerCase())) {
        logger.error(`Unknown executor: ${executorAddress}`);
        continue;
      }
      const executorAccount = getAccountFromAddress(executorAddress);
      if (!executorAccount) {
        continue;
      }
      const networks = config.executors[executorAddress];
      for (const networkId in networks) {
        const accounts = networks[networkId];
        const endpoint = config.endpoints[networkId];
        // log endpoint
        logger.info(`Endpoint: ${endpoint}`);
        const ethersProvider = new ethers.JsonRpcProvider(endpoint);
        await ethersProvider.ready; // Wait for provider to be ready
        const network = await ethersProvider.getNetwork();
        const chainId = network.chainId;

        const proxyFactoryAddress = getProxyFactoryAddress(networkId, networksConfig);
        if (!proxyFactoryAddress) {
          continue;
        }
        const proxyFactory = getProxyFactoryContract(ethersProvider, proxyFactoryAddress);
        for (const ownerAddress of accounts) {
          try {
            const proxyAddress = await proxyFactory.getProxy(ownerAddress);
            if (proxyAddress === ethers.ZeroAddress) {
              logger.info(
                `No proxy deployed for account ${ownerAddress} on network ${networkId}`
              );
              continue;
            }
            const proxy = getProxyContract(ethersProvider, proxyAddress);
            const sellToken = await proxy.sellToken();
            const amount = await proxy.swapAmount();
            const lastSwap = await proxy.lastSwapTime();
            const swapInterval = await proxy.swapInterval();
            const proxyExecutor = await proxy.executor();
            // log all these values
            logger.info(`Proxy Address:  ${proxyAddress}`);
            logger.info(`Sell Token:     ${sellToken}`);
            logger.info(`Amount:         ${amount}`);
            logger.info(`Last Swap:      ${lastSwap}`);
            logger.info(`Swap Interval:  ${swapInterval}`);
            logger.info(`Proxy Executor: ${proxyExecutor}`);
            if (proxyExecutor.toLowerCase() !== executorAddress.toLowerCase()) {
              logger.error(
                `Executor mismatch for account ${ownerAddress} on network ${networkId}`
              );
              continue;
            }
            if (!await verifyInterval(ethersProvider, lastSwap, swapInterval)) {
              logger.info(
                `Swap interval not reached for account ${ownerAddress} on network ${networkId}`
              );
              continue;
            }
            if (
              !(await verifyAllowance(
                ethersProvider,
                sellToken,
                ownerAddress,
                proxyAddress,
                amount
              ))
            ) {
              logger.info(`Insufficient allowance for account ${ownerAddress}`);
              continue;
            }

            // Get ERC20 contracts for sellToken and buyToken
            const erc20Abi = loadAbi('../docs/erc20.json');
            const sellTokenContract = new ethers.Contract(sellToken, erc20Abi, ethersProvider);
            const buyTokenAddress = await proxy.buyToken();
            const buyTokenContract = new ethers.Contract(buyTokenAddress, erc20Abi, ethersProvider);

            // Log balances before swap for owner
            logger.info(`Balances for owner (${ownerAddress}) before swap:`);
            await logTokenBalances(ownerAddress, sellTokenContract, buyTokenContract);

            const buyToken = buyTokenAddress;
            // Get the swap quote
            const swapQuote = await get0xQuote(
              buyToken,
              sellToken,
              amount,
              chainId,
              ownerAddress,
              executorAccount.address,
              50 // 0.5% slippage
            );
            if (!swapQuote) {
              continue;
            }

            // Verify the scaled minimum price
            const isPriceValid = await verifyScaledMinimumPrice(proxy, swapQuote, amount);
            if (!isPriceValid) {
              logger.info(
                `Skipping swap for account ${ownerAddress} on network ${networkId} due to price restrictions.`
              );
              continue;
            }

            // Execute the swap
            const executorAccountWithProvider = executorAccount.connect(ethersProvider);
            const txHash = await executeSwap(
              proxy,
              executorAccountWithProvider,
              swapQuote
            );
            if (txHash) {
              logger.info(
                `Swap executed for account ${ownerAddress} on network ${networkId}. Tx hash: ${txHash}`
              );

              // Log balances after swap for owner
              logger.info(`Balances for owner (${ownerAddress}) after swap:`);
              await logTokenBalances(ownerAddress, sellTokenContract, buyTokenContract);

            } else {
              logger.error(
                `Failed to execute swap for account ${ownerAddress} on network ${networkId}`
              );
            }
          } catch (e) {
            logger.error(
              `Error processing account ${ownerAddress} on network ${networkId}: ${e}`
            );
          }
        }
      }
    }
    // Sleep for 10 minutes before the next iteration
    logger.info('Iteration complete. Sleeping for 10 minutes...');
    await new Promise((resolve) => setTimeout(resolve, 600000)); // 600000 ms = 10 minutes
  }
}

main().catch((error) => {
  logger.error(error);
  exit(1);
});
