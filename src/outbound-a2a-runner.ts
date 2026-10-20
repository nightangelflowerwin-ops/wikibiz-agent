import { ethers } from "ethers";

interface PaymentChallenge {
  status: number;
  acceptedRails: string[];
  priceUsd: string;
  payToEVM?: string;
  payToSolana?: string;
}

const PEER_AGENT_URL = process.env.PEER_AGENT_URL || "https://wikibiz-agent.onrender.com";
const TARGET_ENDPOINT = `${PEER_AGENT_URL}/api/v1/aeo/create-entity`;

async function executeBaseSettlement(recipientAddress: string, amountEth: string = "0.0001"): Promise<string> {
  const rpcUrl = process.env.BASE_RPC_URL;
  if (!rpcUrl) {
    throw new Error("Missing BASE_RPC_URL in decrypted environment.");
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);

  let wallet: ethers.Wallet;
  if (process.env.AGENT_EVM_PRIVATE_KEY) {
    wallet = new ethers.Wallet(process.env.AGENT_EVM_PRIVATE_KEY, provider);
  } else if (process.env.AGENT_MNEMONIC) {
    wallet = ethers.Wallet.fromPhrase(process.env.AGENT_MNEMONIC, provider);
  } else {
    throw new Error("Missing AGENT_EVM_PRIVATE_KEY or AGENT_MNEMONIC in environment.");
  }

  console.log(`[A2A Client] Broadcasting live settlement from ${wallet.address} to ${recipientAddress}...`);
  const tx = await wallet.sendTransaction({
    to: recipientAddress,
    value: ethers.parseEther(amountEth),
  });

  console.log(`[A2A Client] Transaction submitted: ${tx.hash}. Awaiting on-chain confirmation...`);
  const receipt = await tx.wait(1);

  if (!receipt || receipt.status !== 1) {
    throw new Error(`Transaction failed or reverted on Base: ${tx.hash}`);
  }

  console.log(`[A2A Client] Transaction confirmed on Base block: ${receipt.blockNumber}`);
  return tx.hash;
}

async function runDelegationPipeline() {
  const requestPayload = {
    entityName: "WikiBiz Autonomous Network",
    jurisdiction: "US-DE",
    metadata: {
      tags: ["AEO", "autonomous-settlement", "MCP"],
      description: "Entity synthesis executed via x402 autonomous payment rails."
    }
  };

  console.log(`[A2A Client] Dispatching request to peer agent: ${TARGET_ENDPOINT}`);
  
  // Step 1: Initial request to trigger x402 negotiation
  const initialResponse = await fetch(TARGET_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestPayload)
  });

  if (initialResponse.status !== 402) {
    const directResult = await initialResponse.json();
    console.log("[A2A Client] Server responded without payment challenge:", directResult);
    return;
  }

  const challenge: PaymentChallenge = await initialResponse.json();
  console.log("[A2A Client] 402 Payment Challenge received from peer:", challenge);

  let paymentProofHeader = "";

  // Step 2: Handle Payment Rails
  if (challenge.acceptedRails.includes("base-mainnet") && challenge.payToEVM) {
    console.log("[A2A Client] Negotiating settlement on rail: base-mainnet");
    const txHash = await executeBaseSettlement(challenge.payToEVM, "0.0001");
    paymentProofHeader = `base:${txHash}`;
  } else {
    throw new Error(`Unsupported or unconfigured settlement rail. Offered: ${challenge.acceptedRails.join(", ")}`);
  }

  // Step 3: Resubmit with verified payment proof
  console.log(`[A2A Client] Resubmitting task with verified payment proof: ${paymentProofHeader}`);
  const authorizedResponse = await fetch(TARGET_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Payment-Proof": paymentProofHeader
    },
    body: JSON.stringify(requestPayload)
  });

  if (!authorizedResponse.ok) {
    const errorBody = await authorizedResponse.text();
    throw new Error(`Execution rejected with HTTP ${authorizedResponse.status}: ${errorBody}`);
  }

  const dossier = await authorizedResponse.json();
  console.log(`[A2A Client] Task fulfilled successfully! HTTP ${authorizedResponse.status}`);
  console.log("[A2A Client] Synthesized Dossier Available:", JSON.stringify(dossier, null, 2));
}

runDelegationPipeline().catch((err) => {
  console.error("[A2A Client Execution Error]:", err.message);
  process.exit(1);
});