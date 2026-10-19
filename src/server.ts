import express, { Request, Response } from "express";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as path from "path";
import {
  initDatabase,
  saveMerchantEntity,
  fetchAllMerchants,
  savePaymentReceipt,
  checkPaymentReceipt,
} from "./db.js";

const app = express();
app.use(express.json());
app.use(express.static("public"));

// Multi-chain settlement parameters
const AGENT_SETTLEMENT = {
  evm_base_wallet: "0xd10c3ee95466eec2cb89d9eff63d1446b371e59d",
  solana_wallet: "BqW6DZGrasYgJcEnQPzzSAmSH6ty4gdVydPkjKoxdmpE",
  usdc_amount: "1.00",
  sol_amount: "0.006",
  fiat_amount: "1.00",
};

// In-memory fallback if no DB connection is active
const fallbackRegistry: any[] = [];
const fallbackReceipts = new Set<string>();

// Helper to verify PayPal Order ID directly against PayPal REST API
async function verifyPayPalOrder(orderId: string): Promise<boolean> {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  const envMode = process.env.PAYPAL_ENV || "sandbox";

  // Fallback to simulation mode if API credentials are not provided
  if (!clientId || !clientSecret) {
    console.warn("PayPal credentials missing; operating in simulation mode.");
    return orderId.startsWith("PAYPAL-") || orderId.startsWith("ORD-");
  }

  const baseUrl =
    envMode === "live"
      ? "https://api-m.paypal.com"
      : "https://api-m.sandbox.paypal.com";

  try {
    const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const tokenRes = await fetch(`${baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${authHeader}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });

    if (!tokenRes.ok) {
      console.error("Failed to authenticate with PayPal API:", await tokenRes.text());
      return false;
    }

    const { access_token } = (await tokenRes.json()) as { access_token: string };

    const orderRes = await fetch(`${baseUrl}/v2/checkout/orders/${orderId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
      },
    });

    if (!orderRes.ok) {
      console.error(`PayPal order lookup failed for ${orderId}:`, await orderRes.text());
      return false;
    }

    const orderData = (await orderRes.json()) as any;
    const isCompleted = orderData.status === "COMPLETED" || orderData.status === "APPROVED";
    const amountVal = orderData.purchase_units?.[0]?.amount?.value;

    if (isCompleted && parseFloat(amountVal || "0") >= 1.0) {
      return true;
    }

    return false;
  } catch (error) {
    console.error("PayPal verification network exception:", error);
    return false;
  }
}

// Helper to run MCP delegation pipeline
async function delegateAgentTask(userInput: {
  companyName: string;
  website: string;
  founder: string;
  location: string;
  claimedEmployees: number;
}) {
  const discoveryTransport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "src/discovery-mcp.ts"],
  });
  const discoveryClient = new Client({ name: "web-runner", version: "1.0.0" }, { capabilities: {} });
  await discoveryClient.connect(discoveryTransport);

  const paypalTransport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "src/paypal-mcp.ts"],
  });
  const paypalClient = new Client({ name: "web-runner", version: "1.0.0" }, { capabilities: {} });
  await paypalClient.connect(paypalTransport);

  const wikiTransport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "src/wiki-mcp.ts"],
  });
  const wikiClient = new Client({ name: "web-runner", version: "1.0.0" }, { capabilities: {} });
  await wikiClient.connect(wikiTransport);

  // 1a. Profile Extraction
  const profileRes: any = await discoveryClient.callTool({
    name: "extract_merchant_profile",
    arguments: {
      companyName: userInput.companyName,
      websiteUrl: userInput.website,
      founderName: userInput.founder,
    },
  });
  const profileData = JSON.parse(profileRes.content[0].text);

  // 1b. Metrics Standardization
  const metricsRes: any = await discoveryClient.callTool({
    name: "resolve_business_metrics",
    arguments: {
      location: userInput.location,
      claimedEmployees: Number(userInput.claimedEmployees),
    },
  });
  const metricsData = JSON.parse(metricsRes.content[0].text);

  // 1c. Wikimedia Commons Asset Lookup
  let commonsAsset: { filename: string | null; mediaUrl: string | null; license: string | null } = {
    filename: null,
    mediaUrl: null,
    license: null,
  };
  try {
    const commonsRes: any = await discoveryClient.callTool({
      name: "lookup_wikimedia_commons_assets",
      arguments: { companyName: profileData.companyName },
    });
    commonsAsset = JSON.parse(commonsRes.content[0].text);
  } catch (err) {
    console.warn("Wikimedia Commons asset lookup skipped:", err);
  }

  // 2. PayPal Agentic Link
  let checkoutUrl = "";
  try {
    const payRes: any = await paypalClient.callTool({
      name: "create_merchant_payment_link",
      arguments: {
        companyName: userInput.companyName,
        unitAmount: "1.00",
        currency: "USD",
        memo: "Merchant Profile Verification Badge",
      },
    });
    const payData = JSON.parse(payRes.content[0].text);
    checkoutUrl = payData.checkoutUrl || "#";
  } catch (e) {
    checkoutUrl = "https://sandbox.paypal.com";
  }

  // 3a. Wiki Entity Generation (Passing Commons metadata)
  const wikiRes: any = await wikiClient.callTool({
    name: "generate_wiki_entity",
    arguments: {
      companyName: profileData.companyName,
      founder: profileData.founder,
      location: metricsData.standardizedLocation,
      employeeCount: metricsData.employeeCount,
      website: profileData.website,
      summary: profileData.summary,
      paypalCheckoutUrl: checkoutUrl,
      commonsFile: commonsAsset.filename || undefined,
      commonsLogoUrl: commonsAsset.mediaUrl || undefined,
    },
  });
  const wikiData = JSON.parse(wikiRes.content[0].text);

  // 3b. AEO Schema Synthesis (Passing Commons logo URL)
  const aeoRes: any = await wikiClient.callTool({
    name: "generate_aeo_entity_payload",
    arguments: {
      companyName: profileData.companyName,
      founder: profileData.founder,
      location: metricsData.standardizedLocation,
      employeeCount: metricsData.employeeCount,
      website: profileData.website,
      summary: profileData.summary,
      commonsLogoUrl: commonsAsset.mediaUrl || undefined,
    },
  });
  const aeoData = JSON.parse(aeoRes.content[0].text);

  // 4. Assemble Record
  const record = {
    id: `ENT-${Date.now().toString().slice(-4)}`,
    companyName: profileData.companyName,
    founder: profileData.founder,
    location: metricsData.standardizedLocation,
    employees: metricsData.employeeCount,
    bracket: metricsData.headcountBracket,
    website: profileData.website,
    status: "Active & Verified",
    checkoutUrl,
    wikitext: wikiData.wikitext,
    htmlPreview: wikiData.htmlPreview,
    schemaJsonLd: aeoData.schemaJsonLd,
    commonsLogo: commonsAsset.mediaUrl,
    commonsLicense: commonsAsset.license,
  };

  // Persist to Postgres (and in-memory fallback)
  try {
    await saveMerchantEntity(record);
  } catch (err) {
    console.error("Failed to persist record to database:", err);
  }
  fallbackRegistry.unshift(record);

  return record;
}

// -------------------------------------------------------------
// Human Dashboard API Routes (AG Grid)
// -------------------------------------------------------------
app.get("/api/merchants", async (_req: Request, res: Response) => {
  try {
    const merchants = await fetchAllMerchants();
    if (merchants && merchants.length > 0) {
      return res.json(merchants);
    }
  } catch (err) {
    console.warn("Database fetch failed, falling back to memory:", err);
  }
  res.json(fallbackRegistry);
});

app.post("/api/create-entity", async (req: Request, res: Response) => {
  try {
    const record = await delegateAgentTask(req.body);
    res.json({ success: true, record });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// -------------------------------------------------------------
// Autonomous Agent API: x402 Marketplace (PayPal, Base, Solana)
// -------------------------------------------------------------
app.post("/api/v1/aeo/create-entity", async (req: Request, res: Response) => {
  const paymentProof = (
    req.headers["x-payment-proof"] ||
    req.headers["payment-signature"] ||
    req.headers["x-402-token"]
  ) as string;

  const isPaid = paymentProof
    ? (await checkPaymentReceipt(paymentProof)) || fallbackReceipts.has(paymentProof)
    : false;

  if (!paymentProof || !isPaid) {
    const paypalInvoiceToken = `PAYPAL-INV-${Date.now()}`;

    res.setHeader("X-402-Status", "Payment Required");
    res.setHeader("X-402-Price-USD", AGENT_SETTLEMENT.fiat_amount);
    res.setHeader("X-402-Networks", "paypal, base, solana");

    return res.status(402).json({
      status: 402,
      error: "Payment Required",
      protocol: "x402",
      service: {
        name: "WikiBiz Autonomous AEO Knowledge Synthesizer",
        description:
          "Creates verified Wikipedia infoboxes, Schema.org JSON-LD, and PayPal commerce hooks.",
      },
      accepted_payments: [
        {
          rail: "paypal",
          description: "Primary Fiat/Merchant Payment Gateway",
          amount: AGENT_SETTLEMENT.fiat_amount,
          currency: "USD",
          checkout_url: `https://sandbox.paypal.com/checkoutnow?token=${paypalInvoiceToken}`,
          invoice_id: paypalInvoiceToken,
        },
        {
          rail: "base",
          network: "base-mainnet",
          currency: "USDC",
          amount: AGENT_SETTLEMENT.usdc_amount,
          payTo: AGENT_SETTLEMENT.evm_base_wallet,
          scheme: "exact",
        },
        {
          rail: "solana",
          network: "solana-mainnet",
          currency: "SOL",
          amount: AGENT_SETTLEMENT.sol_amount,
          payTo: AGENT_SETTLEMENT.solana_wallet,
          scheme: "exact",
        },
      ],
      instructions:
        "Settle via PayPal ($1.00) or send $1.00 equivalent to the target wallet. Resubmit this POST request with header 'X-Payment-Proof: <token_or_txHash>'",
    });
  }

  try {
    const record = await delegateAgentTask(req.body);
    return res.status(200).json({
      status: "success",
      aeo_status: "Verified & Optimized for LLM Answer Engines",
      payment_receipt: paymentProof,
      entity: record,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Real Web2 Settlement Verification Endpoint
app.post("/api/v1/aeo/verify-payment", async (req: Request, res: Response) => {
  const { orderId, rail } = req.body;

  if (!orderId) {
    return res.status(400).json({ error: "Missing required parameter: orderId" });
  }

  // Cryptographic/API verification against PayPal REST gateway
  const isValid = await verifyPayPalOrder(orderId);

  if (!isValid) {
    return res.status(400).json({
      status: "rejected",
      error: "PayPal order has not been completed or does not meet the $1.00 requirement.",
    });
  }

  // Persist verified receipt to PostgreSQL & memory
  try {
    await savePaymentReceipt(orderId);
  } catch (e) {
    console.warn("Database receipt save skipped, using memory fallback:", e);
  }
  fallbackReceipts.add(orderId);

  return res.json({
    status: "settled",
    receipt: orderId,
    protocol: "x402",
    rail: rail || "paypal",
    message: "Payment successfully verified. Autonomous entity synthesis unlocked.",
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  await initDatabase();
  console.log(`WikiBiz Agent UI running at: http://localhost:${PORT}`);
});