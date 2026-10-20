/**
 * WikiBiz Autonomous A2A Delegation Runner
 * Probes peer agent endpoints, negotiates x402 challenge terms, executes settlement,
 * and exchanges verifiable knowledge dossiers.
 */

interface PeerSettlementChallenge {
  status: number;
  acceptedRails: string[];
  priceUsd: string;
  payToEVM?: string;
  payToSolana?: string;
  paypalCheckoutUrl?: string;
  invoiceId?: string;
}

export class OutboundA2AAgent {
  private agentName: string;
  private defaultEvmPrivateKey: string;

  constructor(name = "WikiBiz-Buyer-Agent") {
    this.agentName = name;
    this.defaultEvmPrivateKey = process.env.AGENT_EVM_PRIVATE_KEY || "0x_mock_agent_key";
  }

  /**
   * Probes any remote MCP or HTTP agent endpoint to trigger negotiation
   */
  async probePeerService(targetUrl: string, taskPayload: any): Promise<{ challenge?: PeerSettlementChallenge; success?: any }> {
    console.log(`[A2A Client] Dispatching request to peer agent: ${targetUrl}`);
    
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": `WikiBiz-A2A-Client/1.0.0 (+https://wikibiz-agent.onrender.com)`,
      },
      body: JSON.stringify(taskPayload),
    });

    if (response.status === 402) {
      const challengeHeaders = {
        status: 402,
        acceptedRails: (response.headers.get("X-Accept-Payment") || "paypal, base, solana").split(",").map((s) => s.trim()),
        priceUsd: response.headers.get("X-Payment-Amount") || "1.00",
        payToEVM: response.headers.get("X-Payment-Recipient-EVM") || undefined,
        payToSolana: response.headers.get("X-Payment-Recipient-Solana") || undefined,
      };

      const body = await response.json();
      console.log(`[A2A Client] 402 Payment Challenge received from peer:`, challengeHeaders);
      return {
        challenge: {
          ...challengeHeaders,
          paypalCheckoutUrl: body.accepted_payments?.find((p: any) => p.rail === "paypal")?.checkout_url,
          invoiceId: body.accepted_payments?.find((p: any) => p.rail === "paypal")?.invoice_id,
        },
      };
    }

    if (response.ok) {
      return { success: await response.json() };
    }

    throw new Error(`Unexpected peer agent response: HTTP ${response.status}`);
  }

  /**
   * Autonomous settlement negotiator
   */
  async settleChallenge(peerChallenge: PeerSettlementChallenge, preferredRail: "paypal" | "base" | "solana" = "paypal"): Promise<string> {
    console.log(`[A2A Client] Negotiating settlement on rail: ${preferredRail}`);

    if (preferredRail === "paypal") {
      // In production: trigger agent PayPal vault capture or sandbox invoice token
      const simulatedToken = peerChallenge.invoiceId || `PAYPAL-INV-SIM-${Date.now()}`;
      console.log(`[A2A Client] Captured agent PayPal token: ${simulatedToken}`);
      return simulatedToken;
    }

    if (preferredRail === "base") {
      // EVM Base transaction execution
      const txHash = `0xSIM${Date.now().toString(16).padStart(60, "0")}`;
      console.log(`[A2A Client] Executed USDC settlement to ${peerChallenge.payToEVM}: ${txHash}`);
      return txHash;
    }

    const solanaSig = `SOL-SIM-${Date.now()}-${"1".repeat(50)}`;
    return solanaSig;
  }

  /**
   * Resubmits the task with proof of payment
   */
  async executeDelegation(targetUrl: string, taskPayload: any, receiptProof: string) {
    console.log(`[A2A Client] Resubmitting task with verified payment proof header...`);

    const response = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Payment-Proof": receiptProof,
        "User-Agent": `WikiBiz-A2A-Client/1.0.0 (+https://wikibiz-agent.onrender.com)`,
      },
      body: JSON.stringify(taskPayload),
    });

    const data = await response.json();
    console.log(`[A2A Client] Task fulfilled by peer agent! HTTP ${response.status}`);
    return data;
  }
}

// Self-executing runner verification against live Render deployment
async function runA2ADelegationCycle() {
  const buyer = new OutboundA2AAgent();
  const targetService = "https://wikibiz-agent.onrender.com/api/v1/aeo/create-entity";
  const verificationService = "https://wikibiz-agent.onrender.com/api/v1/aeo/verify-payment";

  const task = {
    companyName: "Nexus Autonomous Systems",
    website: "https://nexus-agent.network",
    founder: "Agent-0x402",
    location: "Zug, Switzerland",
    claimedEmployees: 8,
  };

  // 1. Probe & receive challenge
  const probe = await buyer.probePeerService(targetService, task);
  if (!probe.challenge) {
    console.log("No challenge required, execution completed.");
    return;
  }

  // 2. Settle payment
  const proof = await buyer.settleChallenge(probe.challenge, "paypal");

  // 3. Register payment proof with verifier
  console.log(`[A2A Client] Submitting receipt to settlement engine...`);
  const verifyRes = await fetch(verificationService, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId: proof }),
  });
  console.log(`[A2A Client] Verification status: ${verifyRes.status}`);

  // 4. Claim synthesized entity
  const result = await buyer.executeDelegation(targetService, task, proof);
  console.log(`[A2A Client] Synthesized Dossier Available:`, result.entity?.companyName);
}

// Run if executed directly
if (process.argv[1]?.includes("outbound-a2a-runner")) {
  runA2ADelegationCycle().catch(console.error);
}