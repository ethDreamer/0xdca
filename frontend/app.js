const provider = new ethers.providers.Web3Provider(window.ethereum);
const proxyFactoryAddress = "0x95dC8748383450B28256913250B39DdEBF962Ece";
let proxyFactoryABI;

async function loadABI() {
    const response = await fetch("factory.json");
    proxyFactoryABI = await response.json();
}

let signer;
let userAddress;

async function connectWallet() {
    if (!proxyFactoryABI) await loadABI();
    await provider.send("eth_requestAccounts", []);
    signer = provider.getSigner();
    userAddress = await signer.getAddress();
    document.getElementById("status-text").innerText = `Connected as ${userAddress}`;
    
    checkProxyStatus();
}

async function checkProxyStatus() {
    const proxyFactoryContract = new ethers.Contract(proxyFactoryAddress, proxyFactoryABI, signer);

    // Check if the user has a deployed proxy
    const hasProxy = await proxyFactoryContract.hasProxy(userAddress);
    if (hasProxy) {
        const proxyAddress = await proxyFactoryContract.getProxy(userAddress);
        document.getElementById("status-text").innerText = `Proxy deployed at: ${proxyAddress}`;
        document.getElementById("create-proxy").style.display = "none";
    } else {
        document.getElementById("status-text").innerText = "No proxy deployed";
        document.getElementById("create-proxy").style.display = "block";
    }
}

async function createProxy() {
    const proxyFactoryContract = new ethers.Contract(proxyFactoryAddress, proxyFactoryABI, signer);
    const tx = await proxyFactoryContract.createProxy();
    await tx.wait();
    checkProxyStatus(); // Refresh status after creating the proxy
}

document.getElementById("connect-wallet").addEventListener("click", connectWallet);
document.getElementById("create-proxy").addEventListener("click", createProxy);
