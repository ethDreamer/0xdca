let provider, proxyFactoryAddress, proxyFactoryABI, dcaABI, signer, userAddress;

document.getElementById("provider-select").addEventListener("change", setupProvider);
document.getElementById("connect-wallet").addEventListener("click", connectWallet);
document.getElementById("create-proxy-button").addEventListener("click", createProxy);
document.addEventListener("DOMContentLoaded", setupProvider);
document.getElementById("create-proxy-form").addEventListener("submit", function(event) {
    event.preventDefault(); // Prevent form from submitting and reloading the page
    createProxy(); // Call the createProxy function instead
});

async function loadNetworkData(chainId) {
    const networks = await fetch("networks.json").then(res => res.json());
    proxyFactoryAddress = networks.networks[chainId]?.proxyFactoryAddress;
    if (!proxyFactoryAddress) console.error("Unsupported network");
}

async function loadABI(file) {
    return fetch(file).then(res => res.json());
}

async function setupProvider() {
    const selectedProvider = document.getElementById("provider-select").value;
    provider = selectedProvider === "metamask" && window.ethereum?.isMetaMask
        ? new ethers.providers.Web3Provider(window.ethereum)
        : selectedProvider === "rabby" && window.ethereum && !window.ethereum.isMetaMask
        ? new ethers.providers.Web3Provider(window.ethereum)
        : null;
    
    if (!provider) {
        alert("Selected provider not available or unable to differentiate.");
        return;
    }
    signer = provider.getSigner();
}

async function connectWallet() {
    const connectButton = document.getElementById("connect-wallet");

    // If already connected, disconnect
    if (userAddress) {
        disconnectWallet();
        return;
    }

    const chainId = document.getElementById("network-select").value;
    await loadNetworkData(chainId);
    proxyFactoryABI = await loadABI("factory.json");
    dcaABI = await loadABI("dca.json");

    if (!proxyFactoryABI || !dcaABI) return;

    try {
        if ((await provider.listAccounts()).length === 0) await provider.send("eth_requestAccounts", []);
        userAddress = (await signer.getAddress()).toLowerCase();
        document.getElementById("status-text").innerText = `Connected as ${userAddress}`;

        // Change button to "Disconnect Wallet"
        connectButton.innerText = "Disconnect Wallet";
        connectButton.classList.replace("btn-primary", "btn-danger");

        await provider.provider.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: ethers.utils.hexValue(parseInt(chainId)) }]
        });

        checkProxyStatus();
    } catch (error) {
        console.error("Wallet connection failed", error);
    }
}

function disconnectWallet() {
    userAddress = null;
    document.getElementById("status-text").innerText = "Not connected";
    document.getElementById("connect-wallet").innerText = "Connect Wallet";
    document.getElementById("connect-wallet").classList.replace("btn-danger", "btn-primary");

    // Hide proxy details and setter cards
    document.getElementById("proxy-details").style.display = "none";
    document.querySelectorAll(".setter-card").forEach(card => card.style.display = "none");
    document.getElementById("create-proxy-form").style.display = "block";
}

async function checkProxyStatus() {
    const proxyFactory = new ethers.Contract(proxyFactoryAddress, proxyFactoryABI, signer);
    try {
        const hasProxy = await proxyFactory.hasProxy(userAddress);
        const statusText = document.getElementById("status-text");
        const createProxyForm = document.getElementById("create-proxy-form");
        const proxyDetails = document.getElementById("proxy-details");

        // Cards for setters
        const setterCards = document.querySelectorAll(".setter-card");

        if (hasProxy) {
            const proxyAddress = await proxyFactory.getProxy(userAddress);
            window.proxyAddress = proxyAddress;
            statusText.innerText = `Proxy deployed at: ${proxyAddress}`;
            createProxyForm.style.display = "none";
            proxyDetails.style.display = "block";

            const dcaContract = new ethers.Contract(proxyAddress, dcaABI, signer);
            window.dcaContract = dcaContract;

            // Show setter cards
            setterCards.forEach(card => card.style.display = "block");

            // Load field values into the static HTML elements
            loadFieldValues(dcaContract);
        } else {
            statusText.innerText = "No proxy deployed";
            createProxyForm.style.display = "block";
            proxyDetails.style.display = "none";

            // Hide setter cards if no proxy is deployed
            setterCards.forEach(card => card.style.display = "none");

            loadTestConfig();
        }
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
            lastSwapTime: 'lastSwapTime'
        };

        for (const [contractField, elementId] of Object.entries(fields)) {
            let value = await contract[contractField]();
            if (typeof value === 'object' && value.toString) {
                value = value.toString();
            }

            const displayElement = document.getElementById(contractField);
            if (displayElement) displayElement.innerText = value; // Update display fields

            const inputElement = document.getElementById(elementId);
            if (inputElement) inputElement.value = value; // Update setter input fields
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
            ethers.utils.parseUnits(document.getElementById("max-swap-amount-input").value, 6),
            parseInt(document.getElementById("min-swap-interval-input").value, 10)
        ];

        const tx = await proxyFactory.createProxy(...values);
        const receipt = await tx.wait();

        if (receipt.status === 0) {
            console.error("Transaction failed");
            return;
        }

        checkProxyStatus();
    } catch (error) {
        console.error("Error creating proxy", error);
    }
}

async function loadTestConfig() {
    const config = await fetch("data/testConfig.json").then(res => res.json());

    // Mapping each form field by its exact ID to the respective config value
    document.getElementById("executor-input").value = config.executorAddress;
    document.getElementById("sell-token-input").value = config.sellTokenAddress;
    document.getElementById("buy-token-input").value = config.buyTokenAddress;
    document.getElementById("quoter-input").value = config.uniswapQuoterAddress;
    document.getElementById("pool-fee-input").value = config.poolFee;
    document.getElementById("max-swap-amount-input").value = config.maxSwapAmount;
    document.getElementById("min-swap-interval-input").value = config.minSwapInterval;
}

// Setter function handlers
async function setExecutor() {
    const executor = document.getElementById("executorSetter").value;
    try {
        const tx = await dcaContract.setExecutor(executor);
        await tx.wait();
        alert("Executor updated successfully.");
        loadFieldValues(dcaContract);
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
        loadFieldValues(dcaContract);
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
        loadFieldValues(dcaContract);
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
        loadFieldValues(dcaContract);
    } catch (error) {
        console.error("Failed to set quoter", error);
        alert("Failed to set quoter.");
    }
}

