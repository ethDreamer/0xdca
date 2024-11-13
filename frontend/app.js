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
    abi.forEach(item => {
        if (item.stateMutability === "view" && item.outputs?.length === 1) {
            config.fields.push({
                name: item.name,
                label: item.name.charAt(0).toUpperCase() + item.name.slice(1),
                type: item.outputs[0].type,
                group: "view"
            });
        } else if (item.stateMutability === "nonpayable" && item.inputs?.length > 0) {
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

function renderFields(config) {
    const container = document.getElementById("proxy-details");
    container.innerHTML = ""; 

    config.fields.forEach(field => {
        if (field.group === "view") {
            container.innerHTML += `
                <div class="mb-3">
                    <label>${field.label}</label>
                    <span id="${field.name}" class="form-control">Loading...</span>
                </div>`;
        }
    });

    Object.keys(config.groups).forEach(group => {
        const groupContainer = document.createElement("div");
        groupContainer.classList.add("field-group");
        config.fields.filter(f => f.group === group).forEach(field => {
            groupContainer.innerHTML += `
                <input type="${field.type === 'address' ? 'text' : 'number'}" 
                       placeholder="${field.label}" 
                       id="${field.name}" 
                       class="form-control mb-3">`;
        });
        groupContainer.innerHTML += `
            <button class="btn btn-primary mb-3" onclick="setFields('${group}')">Set ${group}</button>`;
        container.appendChild(groupContainer);
    });
}

async function loadFieldValues(config, contract) {
    config.fields.filter(field => field.group === "view").forEach(async field => {
        try {
            document.getElementById(field.name).innerText = await contract[field.name]();
        } catch (error) {
            console.error(`Failed to load value for ${field.name}`, error);
        }
    });
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
            statusText.innerText = `Proxy deployed at: ${proxyAddress}`;
            createProxyForm.style.display = "none";
            proxyDetails.style.display = "block"; // Show the proxy details container

            const dcaContract = new ethers.Contract(proxyAddress, dcaABI, signer);
            const dcaConfig = parseABI(dcaABI);
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
    const config = parseABI(dcaABI);
    const dcaContract = new ethers.Contract(proxyAddress, dcaABI, signer);
    const values = config.groups[group].fields.map(name => document.getElementById(name).value);
    await dcaContract[config.groups[group].setter](...values);
}
