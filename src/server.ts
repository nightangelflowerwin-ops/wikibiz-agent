import express, { Request, Response } from "express";
import { ethers } from "ethers";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const BASE_RECIPIENT = (process.env.BASE_RECIPIENT_ADDRESS || "0xd10c3ee95466eec2cb89d9eff63d1446b371e59d").toLowerCase();
const SOLANA_RECIPIENT = process.env.SOLANA_RECIPIENT_ADDRESS || "BqW6DZGrasYgJcEnQPzzSAmSH6ty4gdVydPkjKoxdmpE";
const BASE_RPC_URL = process.env.BASE_RPC_URL || "https://api.developer.coinbase.com/rpc/v1/base/FrQ8A1k49EaF1KLKL9hqdQt9vRM01Uru";

// Helper: Verify Base/EVM transaction live on-chain
async function verifyBasePayment(txHash: string): Promise<boolean> {
  try {
    const provider = new ethers.JsonRpcProvider(BASE_RPC_URL);
    const [tx, receipt] = await Promise.all([
      provider.getTransaction(txHash),
      provider.getTransactionReceipt(txHash)
    ]);

    if (!tx || !receipt) {
      console.warn(`[Settlement Engine] Transaction not found or not yet mined: ${txHash}`);
      return false;
    }

    if (receipt.status !== 1) {
      console.warn(`[Settlement Engine] Transaction reverted: ${txHash}`);
      return false;
    }

    const recipientMatches = tx.to?.toLowerCase() === BASE_RECIPIENT;
    if (!recipientMatches) {
      console.warn(`[Settlement Engine] Recipient mismatch: expected ${BASE_RECIPIENT}, received ${tx.to}`);
      return false;
    }

    return true;
  } catch (error: any) {
    console.error("[Settlement Engine] Base verification error:", error.message);
    return false;
  }
}

// Helper: Verify PayPal Order live via REST API
async function verifyPayPalOrder(orderId: string): Promise<boolean> {
  try {
    const clientId = process.env.PAYPAL_CLIENT_ID;
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
    const isLive = process.env.PAYPAL_ENV === "live";
    const apiBase = isLive ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

    if (!clientId || !clientSecret) {
      console.warn("[Settlement Engine] Missing PayPal credentials.");
      return false;
    }

    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const tokenRes = await fetch(`${apiBase}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: "grant_type=client_credentials"
    });

    if (!tokenRes.ok) return false;
    const tokenData = await tokenRes.json();

    const orderRes = await fetch(`${apiBase}/v2/checkout/orders/${orderId}`, {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`
      }
    });

    if (!orderRes.ok) return false;
    const orderData = await orderRes.json();
    return orderData.status === "COMPLETED";
  } catch (error: any) {
    console.error("[Settlement Engine] PayPal verification error:", error.message);
    return false;
  }
}

// Settlement verification standalone endpoint
app.post("/api/v1/settlement/verify", async (req: Request, res: Response) => {
  const { rail, proof } = req.body;

  if (!rail || !proof) {
    return res.status(400).json({ error: "Missing required fields: rail and proof" });
  }

  let isValid = false;

  if (rail === "base-mainnet" || rail === "base") {
    isValid = await verifyBasePayment(proof);
  } else if (rail === "paypal") {
    isValid = await verifyPayPalOrder(proof);
  }

  if (!isValid) {
    return res.status(400).json({ verified: false, message: "Payment proof validation failed." });
  }

  return res.status(200).json({ verified: true, rail, proof });
});

// Primary AEO entity creation endpoint protected by x402
app.post("/api/v1/aeo/create-entity", async (req: Request, res: Response) => {
  const paymentProof = req.header("X-Payment-Proof");

  // Step 1: Issue challenge if no proof is provided
  if (!paymentProof) {
    return res.status(402).json({
      status: 402,
      priceUsd: "1.00",
      acceptedRails: ["base-mainnet", "paypal", "solana-mainnet"],
      payToEVM: BASE_RECIPIENT,
      payToSolana: SOLANA_RECIPIENT
    });
  }

  // Step 2: Parse and validate payment proof
  let isValid = false;

  if (paymentProof.startsWith("base:")) {
    const txHash = paymentProof.replace("base:", "").trim();
    isValid = await verifyBasePayment(txHash);
  } else if (paymentProof.startsWith("paypal:")) {
    const orderId = paymentProof.replace("paypal:", "").trim();
    isValid = await verifyPayPalOrder(orderId);
  }

  if (!isValid) {
    return res.status(402).json({
      error: "Invalid or unconfirmed payment proof",
      acceptedRails: ["base-mainnet", "paypal", "solana-mainnet"],
      payToEVM: BASE_RECIPIENT,
      payToSolana: SOLANA_RECIPIENT
    });
  }

  // Step 3: Fulfill authorized request
  const { entityName, jurisdiction, metadata } = req.body;
  const synthesizedDossier = {
    entityId: `AEO-${Date.now()}`,
    entityName: entityName || "Default Entity",
    jurisdiction: jurisdiction || "US-DE",
    verificationStatus: "VERIFIED_PAID",
    settlementProof: paymentProof,
    createdAt: new Date().toISOString(),
    metadata: metadata || {}
  };

  return res.status(200).json(synthesizedDossier);
});

app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ status: "healthy", timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`[WikiBiz AEO Server] Running on port ${PORT}`);
});