#!/bin/bash

# Load environment variables from .env file
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
else
  echo ".env file not found."
  exit 1
fi

# Required environment variables
ZERO_EX_API_KEY="16af6bfa-7cb4-4548-88d4-00b86bcbbca8"

# Fetching necessary variables from .env or setting defaults
CHAIN_ID=${CHAIN_ID:-8453}
SELL_TOKEN=${SELL_TOKEN_ADDRESS}
BUY_TOKEN=${BUY_TOKEN_ADDRESS}
SELL_AMOUNT="1000000000"  # Adjusted sell amount (1,000 USDC assuming 6 decimals)
TAKER=${USDC_HOLDER_ADDRESS}
TX_ORIGIN=${EXECUTOR_PRIVATE_KEY}  # Executor address
SLIPPAGE_BPS=${SLIPPAGE_BPS:-100}

# Fetch headers for 0x API requests
HEADERS="Content-Type: application/json"
HEADERS_API_KEY="0x-api-key: $ZERO_EX_API_KEY"
HEADERS_VERSION="0x-version: v2"

# Fetch quote
quote_response=$(curl -s -X GET \
    "https://api.0x.org/swap/allowance-holder/quote?chainId=${CHAIN_ID}&sellToken=${SELL_TOKEN}&buyToken=${BUY_TOKEN}&sellAmount=${SELL_AMOUNT}&taker=${TAKER}&txOrigin=${TX_ORIGIN}&slippageBps=${SLIPPAGE_BPS}" \
    -H "${HEADERS}" \
    -H "${HEADERS_API_KEY}" \
    -H "${HEADERS_VERSION}")

# Print formatted response with jq
echo "$quote_response" | jq
