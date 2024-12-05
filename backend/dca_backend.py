#!/usr/bin/env python3
import json
import time
import logging
import requests
from web3 import Web3
#from web3.middleware import geth_poa_middleware
from eth_account import Account
from typing import Dict, List, Set
from dotenv import load_dotenv
import os
import sys

# Configure logging
logging.basicConfig(level=logging.INFO)

# Load environment variables
load_dotenv()

# Global variable to store known account objects
known_account_objects = []
def load_config(config_file: str) -> Dict:
    """Load the main configuration file."""
    with open(config_file, 'r') as f:
        return json.load(f)


def load_networks(networks_file: str) -> Dict:
    """Load the networks configuration file."""
    with open(networks_file, 'r') as f:
        return json.load(f)['networks']


def read_accounts_securely(seed_phrase_file: str, num_accounts: int) -> Set[str]:
    """
    Reads the seed phrase from a file and generates the first N accounts.
    Returns a set of account addresses.
    """
    Account.enable_unaudited_hdwallet_features()
    global known_account_objects
    with open(seed_phrase_file, 'r') as f:
        seed_phrase = f.read().strip()
    accounts = set()
    known_account_objects = []
    for i in range(num_accounts):
        acct = Account.from_mnemonic(seed_phrase, account_path=f"m/44'/60'/0'/0/{i}")
        accounts.add(acct.address.lower())
        known_account_objects.append(acct)
    return accounts


def get_proxy_factory_address(network_id: str, networks_config: Dict) -> str:
    """Get the proxy factory address from the networks configuration."""
    network_data = networks_config.get(network_id)
    if not network_data:
        logging.error(f"Network ID {network_id} not found in networks configuration.")
        return None
    return network_data.get('proxyFactoryAddress')


def verify_interval(last_swap: int, swap_interval: int) -> bool:
    """Verify if the swap interval has passed."""
    current_time = int(time.time())
    if current_time >= last_swap + swap_interval:
        return True
    else:
        logging.info(f"Swap interval not yet reached. Next swap in {last_swap + swap_interval - current_time} seconds.")
        return False


def verify_allowance(w3: Web3, sell_token_address: str, owner_address: str, spender_address: str, amount: int) -> bool:
    """Verify if the proxy has enough allowance to spend the sell token."""
    erc20_abi = load_abi('../frontend/erc20.json')  # Load ERC20 ABI
    erc20_contract = w3.eth.contract(address=sell_token_address, abi=erc20_abi)
    allowance = erc20_contract.functions.allowance(owner_address, spender_address).call()
    if allowance >= amount:
        return True
    else:
        logging.info(f"Insufficient allowance: {allowance}, required: {amount}")
        return False


def get_0x_quote(buy_token: str, sell_token: str, amount: int, chain_id: str, taker_address: str, tx_origin_address: str, slippage_bps: int = 100) -> Dict:
    # for testing, return the data at ../scripts/data/0xquote.json
    with open('../scripts/data/new_contract_quote.json', 'r') as f:
        return json.load(f)

    """
    Get swap quote from 0x API using the allowance-holder endpoint.
    """
    # Load the ZERO_EX_API_KEY from environment variables
    ZERO_EX_API_KEY = os.environ.get('ZERO_EX_API_KEY')
    if not ZERO_EX_API_KEY:
        logging.error("ZERO_EX_API_KEY not set in environment variables.")
        return None

    api_url = f"https://api.0x.org/swap/allowance-holder/quote"
    params = {
        'buyToken': buy_token,
        'sellToken': sell_token,
        'sellAmount': str(amount),
        'chainId': chain_id,
        'taker': taker_address,
        'txOrigin': tx_origin_address,
        'slippageBps': str(slippage_bps),
    }
    headers = {
        'Content-Type': 'application/json',
        '0x-api-key': ZERO_EX_API_KEY,
        '0x-version': 'v2',
    }
    response = requests.get(api_url, params=params, headers=headers)
    if response.status_code == 200:
        return response.json()
    else:
        logging.error(f"Failed to get quote from 0x API: {response.text}")
        return None


def get_account_from_address(address: str):
    """
    Returns an account object corresponding to the given address.
    """
    global known_account_objects
    for account in known_account_objects:
        if account.address.lower() == address.lower():
            return account
    logging.error(f"Executor account not found for address {address}")
    return None


def get_proxy_factory_contract(w3: Web3, address: str):
    """
    Returns a contract object for the proxy factory.
    """
    abi = load_abi('../frontend/factory.json')
    return w3.eth.contract(address=address, abi=abi)


def get_proxy_contract(w3: Web3, address: str):
    """
    Returns a contract object for the proxy.
    """
    abi = load_abi('../frontend/dca.json')
    return w3.eth.contract(address=address, abi=abi)


def load_abi(abi_file: str) -> List:
    """Load ABI from a JSON file."""
    with open(abi_file, 'r') as f:
        return json.load(f)


def execute_swap(w3: Web3, proxy_contract, executor_account, swap_quote):
    """
    Executes the swap on the proxy contract.
    """
    try:
        # Extract necessary fields from swap_quote
        allowance_target = w3.to_checksum_address(swap_quote['transaction']['to'])
        sell_amount = int(swap_quote['sellAmount'])
        transaction_data = swap_quote['transaction']['data']

        allowance_target_code = w3.eth.get_code(allowance_target)
        print(f"Allowance target code: {allowance_target_code.hex()}")

        # Build the transaction
        tx = proxy_contract.functions.executeSwap(
            allowance_target,
            sell_amount,
            bytes.fromhex(transaction_data[2:])  # Remove '0x' prefix and convert to bytes
        ).build_transaction({
            'from': executor_account.address,
            'gas': int(swap_quote['transaction'].get('gas', 200000)),  # Use quoted or default gas
            'gasPrice': int(swap_quote['transaction'].get('gasPrice', w3.to_wei('20', 'gwei'))),
            'nonce': w3.eth.get_transaction_count(executor_account.address),
            'chainId': int(w3.eth.chain_id),
        })

        # Sign the transaction
        signed_tx = w3.eth.account.sign_transaction(tx, private_key=executor_account.key)

        # Send the transaction
        tx_hash = w3.eth.send_raw_transaction(signed_tx.raw_transaction)
        logging.info(f"Transaction sent with hash: {tx_hash.hex()}")
        return tx_hash

    except Exception as e:
        logging.error(f"Error executing swap: {e}")
        return None



def main():
    # Load configurations
    config = load_config('./config.json')
    networks_config = load_networks('../frontend/networks.json')
    known_accounts = read_accounts_securely('./seed_phrase.txt', num_accounts=20)
    for account in known_accounts:
        logging.info(f"Known account: {account}")

    known_accounts = set(known_accounts)  # Ensure it's a set for quick lookup

    while True:
        logging.info("Starting new iteration...")
        # No sleep at the beginning to run immediately on start
        for executor_address in config['executors']:
            if executor_address.lower() not in known_accounts:
                logging.error(f"Unknown executor: {executor_address}")
                continue
            executor_account = get_account_from_address(executor_address)
            if not executor_account:
                continue
            for network_id in config['executors'][executor_address]:
                accounts = config['executors'][executor_address][network_id]
                endpoint = config['endpoints'][network_id]
                w3 = Web3(Web3.HTTPProvider(endpoint))
                # Handle PoA networks
                #if 'isPoA' in networks_config.get(network_id, {}) and networks_config[network_id]['isPoA']:
                #    w3.middleware_onion.inject(geth_poa_middleware, layer=0)
                proxy_factory_address = get_proxy_factory_address(network_id, networks_config)
                if not proxy_factory_address:
                    continue
                proxy_factory = get_proxy_factory_contract(w3, proxy_factory_address)
                for account_address in accounts:
                    try:
                        proxy_address = proxy_factory.functions.getProxy(account_address).call()
                        if proxy_address == '0x0000000000000000000000000000000000000000':
                            logging.info(f"No proxy deployed for account {account_address} on network {network_id}")
                            continue
                        proxy = get_proxy_contract(w3, proxy_address)
                        sell_token = proxy.functions.sellToken().call()
                        amount = proxy.functions.swapAmount().call()
                        last_swap = proxy.functions.lastSwapTime().call()
                        swap_interval = proxy.functions.swapInterval().call()
                        proxy_executor = proxy.functions.executor().call()
                        if proxy_executor.lower() != executor_address.lower():
                            logging.error(f"Executor mismatch for account {account_address} on network {network_id}")
                            continue
                        if not verify_interval(last_swap, swap_interval):
                            logging.info(f"Swap interval not reached for account {account_address} on network {network_id}")
                            continue
                        if not verify_allowance(w3, sell_token, account_address, proxy_address, amount):
                            logging.info(f"Insufficient allowance for account {account_address}")
                            continue
                        buy_token = proxy.functions.buyToken().call()
                        # Get the swap quote
                        swap_quote = get_0x_quote(
                            buy_token,
                            sell_token,
                            amount,
                            chain_id=network_id,
                            taker_address=proxy_address,
                            tx_origin_address=executor_account.address,
                            slippage_bps=50 # 0.50% slippage
                        )
                        if not swap_quote:
                            continue
                        # Execute the swap
                        tx_hash = execute_swap(w3, proxy, executor_account, swap_quote)
                        if tx_hash:
                            logging.info(f"Swap executed for account {account_address} on network {network_id}. Tx hash: {tx_hash.hex()}")
                        else:
                            logging.error(f"Failed to execute swap for account {account_address} on network {network_id}")
                    except Exception as e:
                        logging.error(f"Error processing account {account_address} on network {network_id}: {e}")
        # Sleep for 10 minutes before the next iteration
        logging.info("Iteration complete. Sleeping for 10 minutes...")
        time.sleep(30)


if __name__ == "__main__":
    main()
