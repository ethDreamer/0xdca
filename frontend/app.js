let provider;
let proxyFactoryAddress;
let proxyFactoryABI;
let dcaABI;
let signer;
let userAddress;

document.getElementById("provider-select").addEventListener("change", async (event) => {
    await setupProvider();
    console.log("Provider changed to:", event.target.value);
});

// Load network data
async function loadNetworkData(chainId) {
    const response = await fetch("networks.json");
    const networks = await response.json();
    const networkData = networks.networks[chainId];
    if (networkData) {
        proxyFactoryAddress = networkData.proxyFactoryAddress;
    } else {
        console.error("Unsupported network");
    }
}

// Load Factory ABI
async function loadFactoryABI() {
    const response = await fetch("factory.json");
    proxyFactoryABI = await response.json();
}
// Load DCA ABI
async function loadDCAABI() {
    const response = await fetch("dca.json");
    dcaABI = await response.json();
}

// Set up provider based on selection
async function setupProvider() {
    const selectedProvider = document.getElementById("provider-select").value;
    if (selectedProvider === "metamask" && window.ethereum?.isMetaMask) {
        provider = new ethers.providers.Web3Provider(window.ethereum);
    } else if (selectedProvider === "rabby" && window.ethereum && !window.ethereum.isMetaMask) {
        provider = new ethers.providers.Web3Provider(window.ethereum);
    } else {
        alert("Selected provider not available or unable to differentiate.");
        return;
    }
    signer = provider.getSigner();
    console.log("Provider set up. Signer: ", signer);
}

// Connect wallet and set up chain
async function connectWallet() {
    const chainId = document.getElementById("network-select").value;
    await loadNetworkData(chainId);

    if (!proxyFactoryABI) await loadFactoryABI();
    await setupProvider();

    // Explicitly request accounts
    const accounts = await provider.listAccounts();
    if (accounts.length === 0) {
        // Prompt the user to connect their wallet
        await provider.send("eth_requestAccounts", []);
    }

    // Re-check for accounts and initialize signer
    userAddress = (await signer.getAddress()).toLowerCase();
    document.getElementById("status-text").innerText = `Connected as ${userAddress}`;

    const hexChainId = ethers.utils.hexValue(parseInt(chainId));
    try {
        await provider.provider.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: hexChainId }]
        });
    } catch (switchError) {
        if (switchError.code === 4902) {
            const networkData = await loadNetworkData(chainId);
            try {
                await provider.provider.request({
                    method: "wallet_addEthereumChain",
                    params: [
                        {
                            chainId: hexChainId,
                            chainName: networkData.chainName,
                            nativeCurrency: {
                                name: networkData.nativeCurrency.name,
                                symbol: networkData.nativeCurrency.symbol,
                                decimals: networkData.nativeCurrency.decimals,
                            },
                            rpcUrls: [networkData.rpcUrl],
                            blockExplorerUrls: [networkData.blockExplorerUrl]
                        }
                    ]
                });
            } catch (addError) {
                console.error("Failed to add network", addError);
            }
        } else {
            console.error("Failed to switch network", switchError);
        }
    }

    checkProxyStatus();
}

async function checkProxyStatus() {
    console.log("proxyFactoryAddress:", proxyFactoryAddress);
    console.log("signer: ", signer);
    const proxyFactoryContract = new ethers.Contract(proxyFactoryAddress, proxyFactoryABI, signer);

    try {
        const hasProxy = await proxyFactoryContract.hasProxy(userAddress);
        if (hasProxy) {
            const proxyAddress = await proxyFactoryContract.getProxy(userAddress);
            document.getElementById("status-text").innerText = `Proxy deployed at: ${proxyAddress}`;
            document.getElementById("create-proxy").style.display = "none";
            document.getElementById("proxy-form").style.display = "none"; // Hide the form
        } else {
            document.getElementById("status-text").innerText = "No proxy deployed";
            document.getElementById("create-proxy").style.display = "block";
            document.getElementById("proxy-form").style.display = "block"; // Show the form

            // for testing
            loadTestConfig()
        }
    } catch (error) {
        console.error("Error checking proxy status:", error);
        document.getElementById("status-text").innerText = "Error checking proxy status.";
        document.getElementById("create-proxy").style.display = "none";
        document.getElementById("proxy-form").style.display = "none"; // Hide the form
    }
}

async function createProxy() {
    try {
        // Retrieve values from the form
        const executor = document.getElementById("executor-input").value;
        const sellToken = document.getElementById("sell-token-input").value;
        const buyToken = document.getElementById("buy-token-input").value;
        const uniswapQuoter = document.getElementById("quoter-input").value;
        const poolFee = parseInt(document.getElementById("pool-fee-input").value, 10);
        const maxSwapAmount = ethers.utils.parseUnits(document.getElementById("max-swap-amount-input").value, 6); // assuming 6 decimals
        const minSwapInterval = parseInt(document.getElementById("min-swap-interval-input").value, 10);

        const proxyFactoryContract = new ethers.Contract(proxyFactoryAddress, proxyFactoryABI, signer);

        // Call createProxy with user-input parameters
        const tx = await proxyFactoryContract.createProxy(
            executor,
            sellToken,
            buyToken,
            uniswapQuoter,
            poolFee,
            maxSwapAmount,
            minSwapInterval
        );

        await tx.wait();
        checkProxyStatus(); // Refresh status after creating the proxy
    } catch (error) {
        console.error("Error creating proxy:", error);
        document.getElementById("status-text").innerText = "Error creating proxy.";
    }
}

// Load test configuration JSON
async function loadTestConfig() {
    const response = await fetch("data/testConfig.json");
    const config = await response.json();

    document.getElementById("executor-input").value = config.executorAddress;
    document.getElementById("sell-token-input").value = config.sellTokenAddress;
    document.getElementById("buy-token-input").value = config.buyTokenAddress;
    document.getElementById("quoter-input").value = config.uniswapQuoterAddress;
    document.getElementById("pool-fee-input").value = config.poolFee;
    document.getElementById("max-swap-amount-input").value = config.maxSwapAmount;
    document.getElementById("min-swap-interval-input").value = config.minSwapInterval;
}

// Event listeners
document.getElementById("connect-wallet").addEventListener("click", connectWallet);
document.getElementById("create-proxy").addEventListener("click", createProxy);
