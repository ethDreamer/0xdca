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

// Parse ABI for UI Configuration
function parseABI(abi) {
    const config = { fields: [], groups: {} };
    abi.forEach(item => {
        if (item.stateMutability === "view" && item.outputs && item.outputs.length === 1) {
            config.fields.push({
                name: item.name,
                label: item.name.charAt(0).toUpperCase() + item.name.slice(1),
                type: item.outputs[0].type,
                group: "view"
            });
        } else if (item.stateMutability === "nonpayable" && item.inputs && item.inputs.length > 0) {
            config.groups[item.name] = { fields: item.inputs.map(input => input.name), setter: item.name };
            item.inputs.forEach(input => {
                config.fields.push({
                    name: input.name,
                    label: input.name.charAt(0).toUpperCase() + input.name.slice(1),
                    type: input.type,
                    group: item.name
                });
            });
        }
    });
    return config;
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

    // Request accounts
    const accounts = await provider.listAccounts();
    if (accounts.length === 0) await provider.send("eth_requestAccounts", []);
    userAddress = (await signer.getAddress()).toLowerCase();
    document.getElementById("status-text").innerText = `Connected as ${userAddress}`;

    const hexChainId = ethers.utils.hexValue(parseInt(chainId));
    try {
        await provider.provider.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: hexChainId }]
        });
    } catch (switchError) {
        console.error("Failed to switch network", switchError);
    }

    checkProxyStatus();
}

// Dynamically render UI elements based on ABI
function renderFields(config) {
    const container = document.getElementById("proxy-form");
    container.innerHTML = ""; // Clear previous content if any

    console.log("config: ", config);

    // Render getter fields (view)
    config.fields.forEach(field => {
        if (field.group === "view") {
            const fieldElement = document.createElement("div");
            fieldElement.classList.add("mb-3");
            fieldElement.innerHTML = `
                <label>${field.label}</label>
                <span id="${field.name}" class="form-control">Loading...</span>
            `;
            container.appendChild(fieldElement);
        }
    });

    // Render setter fields with form elements
    Object.keys(config.groups).forEach(group => {
        const groupFields = config.fields.filter(f => f.group === group);
        const groupContainer = document.createElement("div");
        groupContainer.classList.add("field-group");

        groupFields.forEach(field => {
            const fieldInput = document.createElement("input");
            fieldInput.type = field.type === "address" ? "text" : "number";
            fieldInput.placeholder = field.label;
            fieldInput.id = field.name;
            fieldInput.classList.add("form-control", "mb-3");
            groupContainer.appendChild(fieldInput);
        });

        const submitButton = document.createElement("button");
        submitButton.innerText = `Set ${group}`;
        submitButton.classList.add("btn", "btn-primary", "mb-3");
        submitButton.onclick = async () => {
            const values = groupFields.map(f => document.getElementById(f.name).value);
            const contract = new ethers.Contract(proxyFactoryAddress, dcaABI, signer);
            await contract[config.groups[group].setter](...values);
        };
        groupContainer.appendChild(submitButton);
        container.appendChild(groupContainer);
    });
}

// Load and display getter values
async function loadFieldValues(config, contract) {
    config.fields.filter(field => field.group === "view").forEach(async field => {
        try {
            const value = await contract[field.name]();
            document.getElementById(field.name).innerText = value;
        } catch (error) {
            console.error("Failed to load value for", field.name, error);
        }
    });
}

async function checkProxyStatus() {
    const proxyFactoryContract = new ethers.Contract(proxyFactoryAddress, proxyFactoryABI, signer);

    try {
        const hasProxy = await proxyFactoryContract.hasProxy(userAddress);
        if (hasProxy) {
            const proxyAddress = await proxyFactoryContract.getProxy(userAddress);
            document.getElementById("status-text").innerText = `Proxy deployed at: ${proxyAddress}`;
            document.getElementById("create-proxy").style.display = "none";
            document.getElementById("proxy-form").style.display = "block"; // Ensure form is displayed
            console.log("Proxy address: ", proxyAddress);
            if (!dcaABI) await loadDCAABI();
            const dcaConfig = parseABI(dcaABI); // Parse ABI for fields
            renderFields(dcaConfig); // Render fields based on parsed config
            const dcaContract = new ethers.Contract(proxyAddress, dcaABI, signer); // Create contract instance
            loadFieldValues(dcaConfig, dcaContract); // Load field values for getters
        } else {
            document.getElementById("status-text").innerText = "No proxy deployed";
            document.getElementById("create-proxy").style.display = "block";
            document.getElementById("proxy-form").style.display = "block";
            // for testing
            loadTestConfig();
        }
    } catch (error) {
        console.error("Error checking proxy status:", error);
        document.getElementById("status-text").innerText = "Error checking proxy status.";
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
