const AppState = {
    DISCONNECTED: 'disconnected',
    CONNECTED_NO_PROXY: 'connected_no_proxy',
    CONNECTED_WITH_PROXY: 'connected_with_proxy',
};

let currentState = AppState.DISCONNECTED;
let provider, signer, userAddress, proxyAddress, dcaContract;
let proxyFactoryAddress, proxyFactoryABI, dcaABI;

document.getElementById("provider-select").addEventListener("change", setupProvider);
document.getElementById("network-select").addEventListener("change", setupProvider);
document.getElementById("connect-wallet").addEventListener("click", handleWalletConnection);
document.getElementById("create-proxy-button").addEventListener("click", createProxy);
document.addEventListener("DOMContentLoaded", setupProvider);

function updateUI() {
    const connectButton = document.getElementById("connect-wallet");
    const statusText = document.getElementById("status-text");
    const createProxyForm = document.getElementById("create-proxy-form");
    const proxyDetails = document.getElementById("proxy-details");
    const setterCards = document.querySelectorAll(".setter-card");

    switch (currentState) {
        case AppState.DISCONNECTED:
            statusText.innerText = "Not connected";
            connectButton.innerText = "Connect Wallet";
            connectButton.classList.remove("btn-danger");
            connectButton.classList.add("btn-primary");
            createProxyForm.style.display = "none";
            proxyDetails.style.display = "none";
            setterCards.forEach(card => card.style.display = "none");
            break;

        case AppState.CONNECTED_NO_PROXY:
            statusText.innerText = `Connected as ${userAddress}\nNo proxy deployed`;
            connectButton.innerText = "Disconnect Wallet";
            connectButton.classList.remove("btn-primary");
            connectButton.classList.add("btn-danger");
            createProxyForm.style.display = "block";
            proxyDetails.style.display = "none";
            setterCards.forEach(card => card.style.display = "none");
            break;

        case AppState.CONNECTED_WITH_PROXY:
            statusText.innerText = `Connected as ${userAddress}\nProxy deployed at: ${proxyAddress}`;
            connectButton.innerText = "Disconnect Wallet";
            connectButton.classList.remove("btn-primary");
            connectButton.classList.add("btn-danger");
            createProxyForm.style.display = "none";
            proxyDetails.style.display = "block";
            setterCards.forEach(card => card.style.display = "block");
            break;
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

async function handleWalletConnection() {
    if (currentState === AppState.DISCONNECTED) {
        await connectWallet();
    } else {
        disconnectWallet();
    }
}

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

async function loadNetworkData(chainId) {
    const networks = await fetch("networks.json").then(res => res.json());
    proxyFactoryAddress = networks.networks[chainId]?.proxyFactoryAddress;
    if (!proxyFactoryAddress) {
        console.error("Unsupported network");
    }
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
            loadTestConfig();
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
            maxSwapAmount: 'maxSwapAmountSetter',
            minSwapInterval: 'minSwapIntervalSetter',
            lastSwapTime: 'lastSwapTime',
        };

        for (const [contractField, elementId] of Object.entries(fields)) {
            let value = await contract[contractField]();
            if (ethers.BigNumber.isBigNumber(value)) {
                value = value.toString();
            }

            const displayElement = document.getElementById(contractField);
            if (displayElement) displayElement.innerText = value;

            const inputElement = document.getElementById(elementId);
            if (inputElement) inputElement.value = value;
        }
    } catch (error) {
        console.error("Failed to load contract field values", error);
    }
}

async function createProxy() {
    try {
        const proxyFactory = new ethers.Contract(proxyFactoryAddress, proxyFactoryABI, signer);
        const values = [
            document.getElementById("executor-input").value,
            document.getElementById("sell-token-input").value,
            document.getElementById("buy-token-input").value,
            document.getElementById("quoter-input").value,
            parseInt(document.getElementById("pool-fee-input").value, 10),
            ethers.BigNumber.from(document.getElementById("max-swap-amount-input").value),
            ethers.BigNumber.from(document.getElementById("min-swap-interval-input").value),
        ];

        const tx = await proxyFactory.createProxy(...values);
        await tx.wait();

        await checkProxyStatus();
    } catch (error) {
        console.error("Error creating proxy", error);
    }
}

async function loadTestConfig() {
    const config = await fetch("data/testConfig.json").then(res => res.json());

    document.getElementById("executor-input").value = config.executorAddress;
    document.getElementById("sell-token-input").value = config.sellTokenAddress;
    document.getElementById("buy-token-input").value = config.buyTokenAddress;
    document.getElementById("quoter-input").value = config.uniswapQuoterAddress;
    document.getElementById("pool-fee-input").value = config.poolFee;
    document.getElementById("max-swap-amount-input").value = config.maxSwapAmount;
    document.getElementById("min-swap-interval-input").value = config.minSwapInterval;
}

// Setter function handlers remain the same
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
    const maxSwapAmount = ethers.BigNumber.from(document.getElementById("maxSwapAmountSetter").value);
    const minSwapInterval = ethers.BigNumber.from(document.getElementById("minSwapIntervalSetter").value);
    try {
        const tx = await dcaContract.setSwapParameters(maxSwapAmount, minSwapInterval);
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
