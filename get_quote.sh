#!/bin/bash

# Required environment variables
ZERO_EX_API_KEY="16af6bfa-7cb4-4548-88d4-00b86bcbbca8"

# Tokens and chain details
CHAIN_ID="8453"
SELL_TOKEN="0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"  # USDC contract address
BUY_TOKEN="0x4200000000000000000000000000000000000006"   # WETH contract address
SELL_AMOUNT="100000000"  # Amount of sell token (100 USDC assuming 6 decimals)
TAKER=${1:-0x663e9606Bb8DCc7F7f2089804AD2613721F49cFC}
TX_ORIGIN=${2:-0xbbFFbbF5B71283Cd831F4f173581b8969Ab4728c}  # Executor address
TX_ORIGIN="0x70e73426F7BEE25e854415974399f0e9F5dcc404"
TAKER="0xF4Ad35675e1cD85FE5A14f56573F5618f21d3919"
SLIPPAGE_BPS="100"

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
