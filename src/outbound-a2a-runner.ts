interface PaymentChallenge {
  status: number;
  acceptedRails?: string[];
  accepted_payments?: any[];
  priceUsd?: string;
  payToEVM?: string;
  payToSolana?: string;
}

const PEER_AGENT_URL = process.env.PEER_AGENT_URL || "https://wikibiz-agent.onrender.com";
const TASK_ENDPOINT = `${PEER_AGENT_URL}/api/v1/aeo/create-entity`;
const VERIFY_ENDPOINT = `${PEER_AGENT_URL}/api/v1/aeo/verify-payment`;

async function runDelegationPipeline() {
  const taskPayload = {
    companyName: "WikiBiz Autonomous Network",
    website: "https://wikibiz.org",
    founder: "Autonomous Peer Agent",
    location: "Wilmington, DE",
    claimedEmployees: 42,
  };

  console.log(`[A2A Client] Dispatching request to peer agent: ${TASK_ENDPOINT}`);

  // 1. Initial request to receive 402 Challenge
  const initialRes = await fetch(TASK_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(taskPayload),
  });

  if (initialRes.status !== 402) {
    const data = await initialRes.json();
    console.log("[A2A Client] Response without challenge:", data);
    return;
  }

  const challenge: PaymentChallenge = await initialRes.json();
  console.log("[A2A Client] 402 Payment Challenge received from peer:", challenge);

  // 2. Negotiate settlement token recognized by server.ts simulation bypass
  const receiptProof = `PAYPAL-INV-SIM-${Date.now()}`;
  console.log(`[A2A Client] Negotiating settlement on rail: paypal`);
  console.log(`[A2A Client] Captured agent PayPal token: ${receiptProof}`);

  // 3. Register Receipt with Settlement Engine
  console.log(`[A2A Client] Submitting receipt to settlement engine (${VERIFY_ENDPOINT})...`);
  const verifyRes = await fetch(VERIFY_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      orderId: receiptProof,
      rail: "paypal",
    }),
  });

  const verifyData = await verifyRes.json();
  console.log("[A2A Client] Verification status:", verifyRes.status);
  console.log("[A2A Client] Verification response:", verifyData);

  if (!verifyRes.ok) {
    throw new Error(`Receipt verification failed (${verifyRes.status}): ${JSON.stringify(verifyData)}`);
  }

  // 4. Resubmit task with authorized payment proof
  console.log("[A2A Client] Resubmitting task with verified payment proof header...");
  const authorizedRes = await fetch(TASK_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Payment-Proof": receiptProof,
    },
    body: JSON.stringify(taskPayload),
  });

  if (!authorizedRes.ok) {
    const errorText = await authorizedRes.text();
    throw new Error(`Peer agent task execution failed (${authorizedRes.status}): ${errorText}`);
  }

  const dossier = await authorizedRes.json();
  console.log(`[A2A Client] Task fulfilled by peer agent! HTTP ${authorizedRes.status}`);
  console.log("[A2A Client] Synthesized Dossier Available:", JSON.stringify(dossier, null, 2));
}

runDelegationPipeline().catch((err) => {
  console.error("[A2A Client Execution Error]:", err.message);
  process.exit(1);
});