const AppState = {
    DISCONNECTED: 'disconnected',
    CONNECTED_NO_PROXY: 'connected_no_proxy',
    CONNECTED_WITH_PROXY: 'connected_with_proxy',
};

let currentState = AppState.DISCONNECTED;
let provider, signer, userAddress, proxyAddress, dcaContract;
let proxyFactoryAddress, proxyFactoryABI, dcaABI;
let networkData = {};
const ERC20_ABI = [
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)",
    "function balanceOf(address account) view returns (uint256)"
];

// Event listeners
document.addEventListener("DOMContentLoaded", initializeApp);
document.getElementById("provider-select").addEventListener("change", setupProvider);
document.getElementById("network-select").addEventListener("change", handleNetworkChange);
document.getElementById("connect-wallet").addEventListener("click", handleWalletConnection);
document.getElementById("create-proxy-button").addEventListener("click", createProxy);

// Initialization Functions
async function initializeApp() {
    await populateNetworkSelect();
    updateUI();
}

async function populateNetworkSelect() {
    const networkSelect = document.getElementById('network-select');
    try {
        const networksResponse = await fetch('networks.json');
        const networksData = await networksResponse.json();
        const networks = networksData.networks;

        networkSelect.innerHTML = ''; // Clear any existing options

        for (const [chainId, networkInfo] of Object.entries(networks)) {
            const option = document.createElement('option');
            option.value = chainId;
            option.text = networkInfo.name;
            networkSelect.appendChild(option);
        }

        // Load network data for the first network
        await loadNetworkData(networkSelect.value);
        await setupProvider();
    } catch (error) {
        console.error('Error fetching networks.json', error);
    }
}

async function loadNetworkData(chainId) {
    const networksResponse = await fetch('networks.json');
    const networksData = await networksResponse.json();
    networkData = networksData.networks[chainId];
    if (!networkData) {
        console.error("Unsupported network");
        return;
    }
    proxyFactoryAddress = networkData.proxyFactoryAddress;

    // If connected, check the proxy status
    if (userAddress) {
        await checkProxyStatus();
    }
}

async function setupProvider() {
    const selectedProvider = document.getElementById("provider-select").value;
    provider = null;

    if (selectedProvider === "metamask" && window.ethereum?.isMetaMask) {
        provider = new ethers.providers.Web3Provider(window.ethereum);
    } else if (selectedProvider === "rabby" && window.ethereum && !window.ethereum.isMetaMask) {
        provider = new ethers.providers.Web3Provider(window.ethereum);
    }

    if (!provider) {
        alert("Selected provider not available or unable to differentiate.");
        return;
    }
    signer = provider.getSigner();
}

// Event Handlers
async function handleNetworkChange() {
    await loadNetworkData(document.getElementById("network-select").value);
    updateUI();
}

async function handleWalletConnection() {
    if (currentState === AppState.DISCONNECTED) {
        await connectWallet();
    } else {
        disconnectWallet();
    }
}

// State Management Functions
async function updateUI() {
    const connectButton = document.getElementById("connect-wallet");
    const statusText = document.getElementById("status-text");
    const createProxyForm = document.getElementById("create-proxy-form");
    const proxyDetails = document.getElementById("proxy-details");
    const setterCards = document.querySelectorAll(".setter-card");

    let explorerBaseUrl = networkData?.blockExplorer || "";
    console.log("Explorer base URL: [", explorerBaseUrl, "]");

    switch (currentState) {
        case AppState.DISCONNECTED:
            statusText.innerHTML = "Not connected";
            connectButton.innerText = "Connect Wallet";
            connectButton.classList.remove("btn-danger");
            connectButton.classList.add("btn-primary");
            createProxyForm.style.display = "none";
            proxyDetails.style.display = "none";
            setterCards.forEach(card => card.style.display = "none");
            break;

        case AppState.CONNECTED_NO_PROXY:
            statusText.innerHTML = `Connected as <a href="${explorerBaseUrl}${userAddress}" target="_blank" class="address-link">${userAddress}</a><br/>No proxy deployed`;
            connectButton.innerText = "Disconnect Wallet";
            connectButton.classList.remove("btn-primary");
            connectButton.classList.add("btn-danger");
            createProxyForm.style.display = "block";
            proxyDetails.style.display = "none";
            setterCards.forEach(card => card.style.display = "none");
            await loadInitialConfig();
            break;

        case AppState.CONNECTED_WITH_PROXY:
            statusText.innerHTML = `Connected as <a href="${explorerBaseUrl}${userAddress}" target="_blank" class="address-link">${userAddress}</a><br/>Proxy deployed at: <a href="${explorerBaseUrl}${proxyAddress}" target="_blank" class="address-link">${proxyAddress}</a>`;
            connectButton.innerText = "Disconnect Wallet";
            connectButton.classList.remove("btn-primary");
            connectButton.classList.add("btn-danger");
            createProxyForm.style.display = "none";
            proxyDetails.style.display = "block";
            setterCards.forEach(card => card.style.display = "block");
            break;
    }
}

// Contract Interaction Functions
async function connectWallet() {
    const chainId = document.getElementById("network-select").value;
    await loadNetworkData(chainId);

    proxyFactoryABI = await loadABI("factory.json");
    dcaABI = await loadABI("dca.json");

    if (!proxyFactoryABI || !dcaABI) return;

    try {
        if ((await provider.listAccounts()).length === 0) {
            await provider.send("eth_requestAccounts", []);
        }
        userAddress = (await signer.getAddress()).toLowerCase();

        await provider.provider.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: ethers.utils.hexValue(parseInt(chainId)) }],
        });

        currentState = AppState.CONNECTED_NO_PROXY;
        await checkProxyStatus();
        updateUI(); // Ensure this is called after network data is loaded
    } catch (error) {
        console.error("Wallet connection failed", error);
    }
}

function disconnectWallet() {
    userAddress = null;
    proxyAddress = null;
    dcaContract = null;
    currentState = AppState.DISCONNECTED;
    updateUI();
}

async function loadABI(file) {
    return fetch(file).then(res => res.json());
}

async function checkProxyStatus() {
    const proxyFactory = new ethers.Contract(proxyFactoryAddress, proxyFactoryABI, signer);
    try {
        const hasProxy = await proxyFactory.hasProxy(userAddress);

        if (hasProxy) {
            proxyAddress = await proxyFactory.getProxy(userAddress);
            dcaContract = new ethers.Contract(proxyAddress, dcaABI, signer);
            currentState = AppState.CONNECTED_WITH_PROXY;
            await loadFieldValues(dcaContract);
        } else {
            currentState = AppState.CONNECTED_NO_PROXY;
            await loadInitialConfig();
        }
        updateUI();
    } catch (error) {
        console.error("Error checking proxy status", error);
    }
}

async function loadFieldValues(contract) {
    try {
        const fields = {
            owner: 'owner',
            executor: 'executorSetter',
            sellToken: 'sellTokenSetter',
            buyToken: 'buyTokenSetter',
            uniswapQuoter: 'uniswapQuoterSetter',
            uniswapPoolFee: 'uniswapPoolFeeSetter',
            swapAmount: 'swapAmountSetter',
            swapInterval: 'swapIntervalSetter',
            lastSwapTime: 'lastSwapTime',
            doubleCheck: 'doubleCheckSetter',
        };

        let sellTokenSymbol = '';
        let sellTokenDecimals = 18; // Default to 18 decimals
        let buyTokenSymbol = '';

        for (const [contractField, elementId] of Object.entries(fields)) {
            let value = await contract[contractField]();

            // For BigNumber values, convert to string
            if (ethers.BigNumber.isBigNumber(value)) {
                value = value.toString();
            }

            // Fetch token symbols and decimals
            if (contractField === 'sellToken') {
                try {
                    const sellTokenContract = new ethers.Contract(value, ERC20_ABI, provider);
                    sellTokenSymbol = await sellTokenContract.symbol();
                    sellTokenDecimals = await sellTokenContract.decimals();
                } catch (error) {
                    console.error("Error fetching sell token symbol or decimals", error);
                    sellTokenSymbol = 'UNKNOWN';
                    sellTokenDecimals = 18;
                }
            } else if (contractField === 'buyToken') {
                try {
                    const buyTokenContract = new ethers.Contract(value, ERC20_ABI, provider);
                    buyTokenSymbol = await buyTokenContract.symbol();
                } catch (error) {
                    console.error("Error fetching buy token symbol", error);
                    buyTokenSymbol = 'UNKNOWN';
                }
            }

            // Handle boolean values
            if (typeof value === 'boolean') {
                value = value ? 'True' : 'False';
            }

            // Update display elements
            const displayElement = document.getElementById(contractField);
            if (displayElement) displayElement.innerText = value;

            // Update input elements
            const inputElement = document.getElementById(elementId);
            if (inputElement) {
                // Format swapAmount based on token decimals
                if (contractField === 'swapAmount') {
                    const formattedSwapAmount = ethers.utils.formatUnits(value, sellTokenDecimals);
                    inputElement.value = formattedSwapAmount;
                } else {
                    inputElement.value = value;
                }
            }
        }

        // Update the labels with the token symbols
        const sellTokenLabel = document.getElementById('sellTokenLabel');
        if (sellTokenLabel) sellTokenLabel.innerText = `Sell Token (${sellTokenSymbol})`;

        const buyTokenLabel = document.getElementById('buyTokenLabel');
        if (buyTokenLabel) buyTokenLabel.innerText = `Buy Token (${buyTokenSymbol})`;

        // Update the swap amount label with the sell token symbol
        const swapAmountLabel = document.getElementById('swapAmountLabel');
        if (swapAmountLabel) swapAmountLabel.innerText = `Swap Amount (${sellTokenSymbol})`;

        // Update the swap amount display to show the formatted amount with symbol
        const swapAmountElement = document.getElementById('swapAmount');
        if (swapAmountElement) {
            const swapAmountValue = await contract.swapAmount();
            const formattedSwapAmount = ethers.utils.formatUnits(swapAmountValue, sellTokenDecimals);
            swapAmountElement.innerText = `${formattedSwapAmount} ${sellTokenSymbol}`;
        }

        // Update the sellToken and buyToken display elements to include symbols
        const sellTokenElement = document.getElementById('sellToken');
        if (sellTokenElement) {
            const sellTokenAddress = await contract.sellToken();
            sellTokenElement.innerHTML = `<strong>${sellTokenSymbol}</strong> (${sellTokenAddress})`;

            // After fetching sellTokenSymbol and sellTokenDecimals
            // Fetch the allowance
            const sellTokenContract = new ethers.Contract(sellTokenAddress, ERC20_ABI, signer);
            const allowance = await sellTokenContract.allowance(userAddress, proxyAddress);

            // Check if allowance is MaxUint256 (infinite)
            let formattedAllowance;
            if (allowance.eq(ethers.constants.MaxUint256)) {
                formattedAllowance = "Unlimited";
            } else {
                formattedAllowance = ethers.utils.formatUnits(allowance, sellTokenDecimals);
            }

            // Update the currentAllowance input field
            const currentAllowanceInput = document.getElementById("currentAllowance");
            if (currentAllowanceInput) {
                currentAllowanceInput.value = formattedAllowance;
            }

            // Update the labels with the token symbol
            const currentAllowanceLabel = document.getElementById('currentAllowanceLabel');
            if (currentAllowanceLabel) currentAllowanceLabel.innerText = `Current Allowance (${sellTokenSymbol})`;

            const approveAmountLabel = document.getElementById('approveAmountLabel');
            if (approveAmountLabel) approveAmountLabel.innerText = `Approve Amount (${sellTokenSymbol})`;
        }

        const doubleCheckElement = document.getElementById('doubleCheck');
        if (doubleCheckElement) {
            const doubleCheckValue = await contract.doubleCheck();
            doubleCheckElement.innerText = doubleCheckValue ? 'True' : 'False';
        }

        const buyTokenElement = document.getElementById('buyToken');
        if (buyTokenElement) {
            const buyTokenAddress = await contract.buyToken();
            buyTokenElement.innerHTML = `<strong>${buyTokenSymbol}</strong> (${buyTokenAddress})`;
        }
    } catch (error) {
        console.error("Failed to load contract field values", error);
    }
}

async function approveToken() {
    try {
        const infiniteAllowance = document.getElementById("infiniteAllowanceCheckbox").checked;
        let formattedApproveAmount;
        let sellTokenDecimals = 18; // Default to 18 decimals
        let sellTokenContract;

        // Get sellTokenAddress and sellTokenContract
        const sellTokenAddress = await dcaContract.sellToken();
        sellTokenContract = new ethers.Contract(sellTokenAddress, ERC20_ABI, signer);

        try {
            sellTokenDecimals = await sellTokenContract.decimals();
        } catch (error) {
            console.error("Error fetching sell token decimals", error);
        }

        if (infiniteAllowance) {
            formattedApproveAmount = ethers.constants.MaxUint256;
        } else {
            const approveAmountInput = document.getElementById("approveAmount").value;
            formattedApproveAmount = ethers.utils.parseUnits(approveAmountInput, sellTokenDecimals);
        }

        // Approve the token
        const tx = await sellTokenContract.approve(proxyAddress, formattedApproveAmount);
        await tx.wait();
        alert("Token approved successfully.");

        // Reload the allowance
        const allowance = await sellTokenContract.allowance(userAddress, proxyAddress);

        let formattedAllowance;
        if (allowance.eq(ethers.constants.MaxUint256)) {
            formattedAllowance = "Unlimited";
        } else {
            formattedAllowance = ethers.utils.formatUnits(allowance, sellTokenDecimals);
        }

        const currentAllowanceInput = document.getElementById("currentAllowance");
        if (currentAllowanceInput) {
            currentAllowanceInput.value = formattedAllowance;
        }

        // Reset the approveAmount input field and uncheck the infiniteAllowanceCheckbox
        document.getElementById("approveAmount").value = "";
        document.getElementById("infiniteAllowanceCheckbox").checked = false;

    } catch (error) {
        console.error("Failed to approve token", error);
        alert("Failed to approve token.");
    }
}

async function createProxy() {
    try {
        const proxyFactory = new ethers.Contract(proxyFactoryAddress, proxyFactoryABI, signer);

        // Fetch the sell token decimals
        const sellTokenAddress = document.getElementById("sell-token-input").value;
        let sellTokenDecimals = 18; // Default to 18 decimals
        try {
            const sellTokenContract = new ethers.Contract(sellTokenAddress, ERC20_ABI, provider);
            sellTokenDecimals = await sellTokenContract.decimals();
        } catch (error) {
            console.error("Error fetching sell token decimals", error);
        }

        const swapAmountInput = document.getElementById("swap-amount-input").value;
        const formattedSwapAmount = ethers.utils.parseUnits(swapAmountInput, sellTokenDecimals);

        const values = [
            document.getElementById("executor-input").value,
            sellTokenAddress,
            document.getElementById("buy-token-input").value,
            document.getElementById("quoter-input").value,
            parseInt(document.getElementById("pool-fee-input").value, 10),
            formattedSwapAmount,
            ethers.BigNumber.from(document.getElementById("swap-interval-input").value),
        ];

        const tx = await proxyFactory.createProxy(...values);
        await tx.wait();

        await checkProxyStatus();
    } catch (error) {
        console.error("Error creating proxy", error);
    }
}

async function loadInitialConfig() {
    const config = networkData.initialConfig;
    if (!config) {
        console.error("No initial config available for this network.");
        return;
    }

    document.getElementById("executor-input").value = config.executorAddress;
    document.getElementById("sell-token-input").value = config.sellTokenAddress;
    document.getElementById("buy-token-input").value = config.buyTokenAddress;
    document.getElementById("quoter-input").value = config.uniswapQuoterAddress || networkData.uniswapQuoter;
    document.getElementById("pool-fee-input").value = config.poolFee;

    // Fetch sell token decimals and symbol to format the swap amount and update label
    let sellTokenDecimals = 18; // Default to 18 decimals
    let sellTokenSymbol = '';
    try {
        const sellTokenContract = new ethers.Contract(config.sellTokenAddress, ERC20_ABI, provider);
        sellTokenDecimals = await sellTokenContract.decimals();
        sellTokenSymbol = await sellTokenContract.symbol();
    } catch (error) {
        console.error("Error fetching sell token decimals or symbol", error);
        sellTokenSymbol = 'UNKNOWN';
    }

    const formattedSwapAmount = ethers.utils.formatUnits(config.swapAmount.toString(), sellTokenDecimals);
    document.getElementById("swap-amount-input").value = formattedSwapAmount;
    document.getElementById("swap-interval-input").value = config.swapInterval;

    // Update the swap amount label to include the sell token symbol
    const swapAmountInputLabel = document.getElementById("swap-amount-input-label");
    if (swapAmountInputLabel) {
        swapAmountInputLabel.innerText = `Swap Amount (${sellTokenSymbol})`;
    }
}

// Setter function handlers
async function setExecutor() {
    const executor = document.getElementById("executorSetter").value;
    try {
        const tx = await dcaContract.setExecutor(executor);
        await tx.wait();
        alert("Executor updated successfully.");
        await loadFieldValues(dcaContract);
    } catch (error) {
        console.error("Failed to set executor", error);
        alert("Failed to set executor.");
    }
}

async function setTokens() {
    const sellToken = document.getElementById("sellTokenSetter").value;
    const buyToken = document.getElementById("buyTokenSetter").value;
    const uniswapPoolFee = parseInt(document.getElementById("uniswapPoolFeeSetter").value, 10);
    try {
        const tx = await dcaContract.setTokens(sellToken, buyToken, uniswapPoolFee);
        await tx.wait();
        alert("Tokens updated successfully.");
        await loadFieldValues(dcaContract);
    } catch (error) {
        console.error("Failed to set tokens", error);
        alert("Failed to set tokens.");
    }
}

async function setSwapParameters() {
    // Fetch the sell token decimals
    let sellTokenDecimals = 18; // Default to 18 decimals
    try {
        const sellTokenAddress = await dcaContract.sellToken();
        const sellTokenContract = new ethers.Contract(sellTokenAddress, ERC20_ABI, provider);
        sellTokenDecimals = await sellTokenContract.decimals();
    } catch (error) {
        console.error("Error fetching sell token decimals", error);
    }

    const swapAmountInput = document.getElementById("swapAmountSetter").value;
    const formattedSwapAmount = ethers.utils.parseUnits(swapAmountInput, sellTokenDecimals);
    const swapInterval = ethers.BigNumber.from(document.getElementById("swapIntervalSetter").value);
    try {
        const tx = await dcaContract.setSwapParameters(formattedSwapAmount, swapInterval);
        await tx.wait();
        alert("Swap parameters updated successfully.");
        await loadFieldValues(dcaContract);
    } catch (error) {
        console.error("Failed to set swap parameters", error);
        alert("Failed to set swap parameters.");
    }
}

async function setQuoter() {
    const uniswapQuoter = document.getElementById("uniswapQuoterSetter").value;
    try {
        const tx = await dcaContract.setQuoter(uniswapQuoter);
        await tx.wait();
        alert("Quoter updated successfully.");
        await loadFieldValues(dcaContract);
    } catch (error) {
        console.error("Failed to set quoter", error);
        alert("Failed to set quoter.");
    }
}

async function setDoubleCheck() {
    const doubleCheckValue = document.getElementById("doubleCheckSetter").value;
    const booleanValue = (doubleCheckValue === 'true');

    try {
        const tx = await dcaContract.setDoubleCheck(booleanValue);
        await tx.wait();
        alert("Double Check updated successfully.");
        await loadFieldValues(dcaContract);
    } catch (error) {
        console.error("Failed to set doubleCheck", error);
        alert("Failed to set Double Check.");
    }
}