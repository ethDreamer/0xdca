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
    const chainId = document.getElementById("network-select").value;
    await loadNetworkData(chainId);
    proxyFactoryABI = await loadABI("factory.json");
    dcaABI = await loadABI("dca.json");

    if (!proxyFactoryABI || !dcaABI) return;

    if ((await provider.listAccounts()).length === 0) await provider.send("eth_requestAccounts", []);
    userAddress = (await signer.getAddress()).toLowerCase();
    document.getElementById("status-text").innerText = `Connected as ${userAddress}`;

    try {
        await provider.provider.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: ethers.utils.hexValue(parseInt(chainId)) }]
        });
    } catch (switchError) {
        console.error("Network switch failed", switchError);
    }

    checkProxyStatus();
}

function parseABI(abi) {
    const config = { fields: [], groups: {} };
    const excludeFunctions = ['initialize'];
    const includeFunctions = ['setExecutor', 'setTokens', 'setSwapParameters', 'setQuoter'];

    abi.forEach(item => {
        if (excludeFunctions.includes(item.name)) {
            // Skip excluded functions
            return;
        }

        if (item.stateMutability === "view" && item.outputs?.length === 1) {
            config.fields.push({
                name: item.name,
                label: formatLabel(item.name),
                type: item.outputs[0].type,
                group: "view"
            });
        } else if (
            item.stateMutability === "nonpayable" &&
            item.inputs?.length > 0 &&
            includeFunctions.includes(item.name)
        ) {
            config.groups[item.name] = { fields: item.inputs.map(input => input.name), setter: item.name };
            item.inputs.forEach(input => {
                config.fields.push({
                    name: `${item.name}_${input.name}`, // Ensure unique IDs
                    label: formatLabel(input.name),
                    type: input.type,
                    group: item.name
                });
            });
        }
    });
    return config;
}

function formatLabel(name) {
    // Convert camelCase or snake_case to Proper Case with spaces
    const spacedName = name.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ');
    return spacedName.charAt(0).toUpperCase() + spacedName.slice(1);
}

function renderFields(config) {
    const container = document.getElementById("proxy-details");
    container.innerHTML = ""; 

    // Render view fields
    container.innerHTML += `<h4>Contract Information</h4>`;
    config.fields.filter(field => field.group === "view").forEach(field => {
        container.innerHTML += `
            <div class="mb-3">
                <label>${field.label}</label>
                <span id="${field.name}" class="form-control">Loading...</span>
            </div>`;
    });

    // Render groups (nonpayable functions with inputs)
    Object.keys(config.groups).forEach(group => {
        const groupContainer = document.createElement("div");
        groupContainer.classList.add("field-group");
        groupContainer.innerHTML += `<h5>${formatLabel(group)}</h5>`;
        config.fields.filter(f => f.group === group).forEach(field => {
            groupContainer.innerHTML += `
                <div class="mb-3">
                    <label for="${field.name}" class="form-label">${field.label}</label>
                    <input type="${field.type === 'address' ? 'text' : 'number'}" 
                           placeholder="${field.label}" 
                           id="${field.name}" 
                           class="form-control">
                </div>`;
        });
        groupContainer.innerHTML += `
            <button class="btn btn-primary mb-3" onclick="setFields('${group}')">${formatLabel(group)}</button>`;
        container.appendChild(groupContainer);
    });
}

async function loadFieldValues(config, contract) {
    const viewFields = config.fields.filter(field => field.group === "view");
    for (const field of viewFields) {
        try {
            let value = await contract[field.name]();
            if (field.type.startsWith('uint') || field.type.startsWith('int')) {
                value = value.toString(); // Convert BigNumber to string
            }
            document.getElementById(field.name).innerText = value;
        } catch (error) {
            console.error(`Failed to load value for ${field.name}`, error);
        }
    }
}

async function checkProxyStatus() {
    const proxyFactory = new ethers.Contract(proxyFactoryAddress, proxyFactoryABI, signer);
    try {
        const hasProxy = await proxyFactory.hasProxy(userAddress);
        const statusText = document.getElementById("status-text");
        const createProxyForm = document.getElementById("create-proxy-form");
        const proxyDetails = document.getElementById("proxy-details");

        if (hasProxy) {
            const proxyAddress = await proxyFactory.getProxy(userAddress);
            window.proxyAddress = proxyAddress; // Store in global variable
            statusText.innerText = `Proxy deployed at: ${proxyAddress}`;
            createProxyForm.style.display = "none";
            proxyDetails.style.display = "block"; // Show the proxy details container

            const dcaContract = new ethers.Contract(proxyAddress, dcaABI, signer);
            window.dcaContract = dcaContract; // Store in global variable
            const dcaConfig = parseABI(dcaABI);
            window.dcaConfig = dcaConfig; // Store in global variable
            renderFields(dcaConfig);
            loadFieldValues(dcaConfig, dcaContract);
        } else {
            statusText.innerText = "No proxy deployed";
            createProxyForm.style.display = "block";
            proxyDetails.style.display = "none"; // Hide the proxy details container
            loadTestConfig();
        }
    } catch (error) {
        console.error("Error checking proxy status", error);
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

async function setFields(group) {
    const config = window.dcaConfig;
    const dcaContract = window.dcaContract;
    const fieldNames = config.groups[group].fields;
    const values = fieldNames.map(name => {
        const field = config.fields.find(f => f.name === `${group}_${name}`);
        let value = document.getElementById(`${group}_${name}`).value;
        if (field.type.startsWith('uint')) {
            value = ethers.BigNumber.from(value);
        }
        return value;
    });
    try {
        const tx = await dcaContract[config.groups[group].setter](...values);
        await tx.wait();
        // Optionally, update the displayed values
        loadFieldValues(config, dcaContract);
        alert(`${formatLabel(group)} updated successfully.`);
    } catch (error) {
        console.error(`Failed to set fields for ${group}`, error);
        alert(`Failed to set ${formatLabel(group)}.`);
    }
}

