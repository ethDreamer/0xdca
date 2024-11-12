require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();
require("hardhat-tracer");
const { OWNER_PRIVATE_KEY, EXECUTOR_PRIVATE_KEY, INFURA_API_KEY } = process.env;

module.exports = {
  solidity: {
    compilers: [
      {
        version: "0.8.4", // Add this older version for Uniswap dependencies
        settings: {},
      },
    ],
  },
  networks: {
    hardhat: {
      forking: {
        url: `https://base-mainnet.infura.io/v3/${INFURA_API_KEY}`,
        blockNumber: 21062365,
      },
      chains: {
        8453: {
          hardforkHistory: {
            "cancun": 21062365
          }
        }
      },
      accounts: [
        {
          privateKey: `0x${OWNER_PRIVATE_KEY}`,
          balance: "10000000000000000000"
        },
        {
          privateKey: `0x${EXECUTOR_PRIVATE_KEY}`,
          balance: "1000000000000000000"
        },
      ],
      tracing: true,
      gas: "auto",
    },
    localhost: {
      url: "http://127.0.0.1:8545",
    },
  },
};
