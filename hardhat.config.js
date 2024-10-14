require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

module.exports = {
  solidity: "0.8.0",
  networks: {
    hardhat: {
      forking: {
        url: `https://base-mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`,
        blockNumber: 21040368, // Optional: Specify block for stable state
      },
    },
    localhost: {
      url: "http://127.0.0.1:8545",
    },
  },
};
