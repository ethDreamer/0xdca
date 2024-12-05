#!/usr/bin/env python3
import os
import json
import logging
from web3 import Web3
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Environment variables
OWNER_PRIVATE_KEY = os.environ.get('OWNER_PRIVATE_KEY')
EXECUTOR_PRIVATE_KEY = os.environ.get('EXECUTOR_PRIVATE_KEY')
UNISWAP_QUOTER = os.environ.get('UNISWAP_QUOTER')
CHAIN_ID = int(os.environ.get('CHAIN_ID', '8453'))
SELL_TOKEN_ADDRESS = os.environ.get('SELL_TOKEN_ADDRESS')  # USDC
BUY_TOKEN_ADDRESS = os.environ.get('BUY_TOKEN_ADDRESS')    # WETH
SELL_UNITS_WHOLE = os.environ.get('SELL_UNITS_WHOLE', '1000')

# Web3 setup
w3 = Web3(Web3.HTTPProvider('http://127.0.0.1:1337'))

# Logging setup
logging.basicConfig(level=logging.INFO)

# Accounts
owner_account = w3.eth.account.from_key(OWNER_PRIVATE_KEY)
executor_account = w3.eth.account.from_key(EXECUTOR_PRIVATE_KEY)

# Read proxy address
with open('./scripts/data/proxyAddress.txt', 'r') as f:
    proxy_address = f.read().strip()

# Load ABIs
with open('./frontend/dca.json', 'r') as f:
    dca_abi = json.load(f)
with open('./frontend/erc20.json', 'r') as f:
    erc20_abi = json.load(f)

# Contract instances
usdc_contract = w3.eth.contract(address=w3.to_checksum_address(SELL_TOKEN_ADDRESS), abi=erc20_abi)
proxy_contract = w3.eth.contract(address=w3.to_checksum_address(proxy_address), abi=dca_abi)

# Function to check and approve USDC if needed
def ensure_usdc_approval(sell_amount):
    usdc_allowance = usdc_contract.functions.allowance(owner_account.address, proxy_address).call()
    if usdc_allowance < sell_amount:
        logging.info('Approving USDC for proxy...')
        nonce_owner = w3.eth.get_transaction_count(owner_account.address)
        approve_tx = usdc_contract.functions.approve(
            proxy_address,
            w3.toWei(2 ** 256 - 1, 'wei')  # MaxUint256
        ).build_transaction({
            'from': owner_account.address,
            'nonce': nonce_owner,
            'gas': 100000,
            'maxFeePerGas': w3.toWei('100', 'gwei'),
            'maxPriorityFeePerGas': w3.toWei('2', 'gwei'),
            'chainId': CHAIN_ID,
        })
        signed_approve_tx = owner_account.sign_transaction(approve_tx)
        approve_tx_hash = w3.eth.send_raw_transaction(signed_approve_tx.raw_transaction)
        w3.eth.wait_for_transaction_receipt(approve_tx_hash)
        logging.info('USDC approved for proxy.')

# Function to execute swap
def execute_swap(w3: Web3, proxy_contract, executor_account, swap_quote):
    """
    Executes the swap on the proxy contract.
    """
    try:
        # log the swap quote
        print(f"Swap quote: ", json.dumps(swap_quote, indent=4))
        # log the executor
        logging.info(f"Executor: {executor_account.address}")
        # log the proxy contract
        logging.info(f"Proxy Contract: {proxy_contract.address}")

        # Extract necessary fields from swap_quote
        allowance_target = w3.to_checksum_address(swap_quote['transaction']['to'])
        sell_amount = int(swap_quote['sellAmount'])
        transaction_data = swap_quote['transaction']['data']

        # Get fee data
        fee_data = w3.eth.fee_history(1, 'latest')
        base_fee = fee_data['baseFeePerGas'][-1]
        max_priority_fee_per_gas = w3.to_wei('2', 'gwei')
        max_fee_per_gas = base_fee + max_priority_fee_per_gas

        # Build the transaction
        tx = proxy_contract.functions.executeSwap(
            allowance_target,
            sell_amount,
            transaction_data  # Pass as hex string
        ).build_transaction({
            'from': executor_account.address,
            'gas': int(swap_quote['transaction'].get('gas', 500000)),
            'maxFeePerGas': int(max_fee_per_gas),
            'maxPriorityFeePerGas': int(max_priority_fee_per_gas),
            'nonce': w3.eth.get_transaction_count(executor_account.address),
            'chainId': int(w3.eth.chain_id),
        })

        # Sign the transaction
        signed_tx = executor_account.sign_transaction(tx)

        # Send the transaction
        tx_hash = w3.eth.send_raw_transaction(signed_tx.raw_transaction)
        logging.info(f"Transaction sent with hash: {tx_hash.hex()}")
        return tx_hash

    except Exception as e:
        logging.error(f"Error executing swap: {e}")
        return None

# Main execution
if __name__ == '__main__':
    sell_amount = int(float(SELL_UNITS_WHOLE) * (10 ** 6))  # USDC has 6 decimals
    usdc_balance = usdc_contract.functions.balanceOf(owner_account.address).call()
    logging.info(f'Owner USDC Balance: {usdc_balance / (10 ** 6)}')
    if usdc_balance < sell_amount:
        logging.error('Owner does not have enough USDC balance')
        exit(1)

    # Ensure USDC is approved for the proxy contract
    ensure_usdc_approval(sell_amount)

    # Load swap quote
    with open('./scripts/data/new_contract_quote.json', 'r') as f:
        swap_quote = json.load(f)

    # Get executor balance
    executor_balance = w3.eth.get_balance(executor_account.address)
    logging.info(f'Executor ETH Balance: {w3.from_wei(executor_balance, "ether")}')

    # Execute the swap
    tx_hash = execute_swap(w3, proxy_contract, executor_account, swap_quote)
    if tx_hash:
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
        logging.info(f'Transaction receipt: {receipt}')

    # Check balances after swap
    usdc_balance_after = usdc_contract.functions.balanceOf(owner_account.address).call()
    weth_contract = w3.eth.contract(address=BUY_TOKEN_ADDRESS, abi=erc20_abi)
    weth_balance = weth_contract.functions.balanceOf(owner_account.address).call()
    logging.info(f'Owner USDC Balance after swap: {usdc_balance_after / (10 ** 6)}')
    logging.info(f'Owner WETH Balance after swap: {weth_balance / (10 ** 18)}')
