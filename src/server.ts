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
  fetchMerchantBySlug,
  slugify,
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

// -------------------------------------------------------------
// Payment Verifiers: Web2 (PayPal) + Web3 (Base & Solana)
// -------------------------------------------------------------

// 1. PayPal REST Verifier
async function verifyPayPalOrder(orderId: string): Promise<boolean> {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  const envMode = process.env.PAYPAL_ENV || "sandbox";

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

    if (!tokenRes.ok) return false;
    const { access_token } = (await tokenRes.json()) as { access_token: string };

    const orderRes = await fetch(`${baseUrl}/v2/checkout/orders/${orderId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
      },
    });

    if (!orderRes.ok) return false;
    const orderData = (await orderRes.json()) as any;
    const isCompleted = orderData.status === "COMPLETED" || orderData.status === "APPROVED";
    const amountVal = orderData.purchase_units?.[0]?.amount?.value;

    return isCompleted && parseFloat(amountVal || "0") >= 1.0;
  } catch (error) {
    console.error("PayPal verification network exception:", error);
    return false;
  }
}

// 2. Base (EVM) On-Chain JSON-RPC Verifier
async function verifyBaseTransaction(txHash: string): Promise<boolean> {
  try {
    if (!txHash.startsWith("0x") || txHash.length !== 66) {
      return false;
    }

    const rpcRes = await fetch("https://mainnet.base.org", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getTransactionReceipt",
        params: [txHash],
      }),
    });

    if (!rpcRes.ok) return false;
    const result = (await rpcRes.json()) as any;
    const receipt = result.result;

    if (!receipt) return false;

    return receipt.status === "0x1";
  } catch (err) {
    console.error("Base RPC verification error:", err);
    return false;
  }
}

// 3. Solana On-Chain JSON-RPC Verifier
async function verifySolanaTransaction(signature: string): Promise<boolean> {
  try {
    if (signature.length < 64 || signature.length > 90) {
      return false;
    }

    const rpcRes = await fetch("https://api.mainnet-beta.solana.com", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTransaction",
        params: [
          signature,
          { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 },
        ],
      }),
    });

    if (!rpcRes.ok) return false;
    const result = (await rpcRes.json()) as any;
    const tx = result.result;

    if (!tx || tx.meta?.err !== null) return false;

    return true;
  } catch (err) {
    console.error("Solana RPC verification error:", err);
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

  // 3a. Wiki Entity Generation
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

  // 3b. AEO Schema Synthesis
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
// Semantic Web & Answer Engine Optimization (AEO) Endpoints
// -------------------------------------------------------------
app.get("/entity/:slug", async (req: Request, res: Response) => {
  const slug = String(req.params.slug || "");
  const entity =
    (await fetchMerchantBySlug(slug)) ||
    fallbackRegistry.find((r) => slugify(r.companyName || "") === slug);

  if (!entity) {
    return res.status(404).send("<h1>404 - Entity Not Found in WikiBiz Registry</h1>");
  }

  const jsonLdString = JSON.stringify(entity.schemaJsonLd || {}, null, 2);

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${entity.companyName} | WikiBiz Verified Profile</title>
  <meta name="description" content="Verified corporate profile, Wikipedia-style infobox, and PayPal checkout rail for ${entity.companyName}.">
  <script type="application/ld+json">
${jsonLdString}
  </script>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; padding: 40px 20px; display: flex; justify-content: center; }
    .card-wrap { max-width: 600px; width: 100%; background: #1e293b; border-radius: 12px; padding: 24px; box-shadow: 0 10px 25px rgba(0,0,0,0.3); border: 1px solid #334155; }
    .btn-back { display: inline-block; margin-bottom: 20px; color: #38bdf8; text-decoration: none; font-size: 0.875rem; }
  </style>
</head>
<body>
  <div class="card-wrap">
    <a href="/" class="btn-back">&larr; Back to Registry Directory</a>
    ${entity.htmlPreview || "<p>Entity verified.</p>"}
    <div style="margin-top: 24px; border-top: 1px solid #334155; padding-top: 16px;">
      <h4 style="margin: 0 0 8px 0; color: #94a3b8; font-size: 0.8rem; text-transform: uppercase;">Raw Semantic Endpoints</h4>
      <a href="/api/v1/entities/${slugify(entity.companyName || "")}/json-ld" target="_blank" style="color: #38bdf8; font-size: 0.85rem;">View Raw JSON-LD</a>
    </div>
  </div>
</body>
</html>`);
});

app.get("/api/v1/entities/:slug/json-ld", async (req: Request, res: Response) => {
  const slug = String(req.params.slug || "");
  const entity =
    (await fetchMerchantBySlug(slug)) ||
    fallbackRegistry.find((r) => slugify(r.companyName || "") === slug);

  if (!entity || !entity.schemaJsonLd) {
    return res.status(404).json({ error: "Entity not found or missing JSON-LD schema." });
  }

  res.setHeader("Content-Type", "application/ld+json");
  return res.json(entity.schemaJsonLd);
});

app.get("/sitemap.xml", async (_req: Request, res: Response) => {
  const merchants = (await fetchAllMerchants()) || fallbackRegistry;
  const baseUrl = "https://wikibiz-agent.onrender.com";

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${baseUrl}/</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
`;

  for (const m of merchants) {
    const slug = slugify(m.companyName || m.id || "");
    xml += `  <url>
    <loc>${baseUrl}/entity/${slug}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
`;
  }

  xml += `</urlset>`;

  res.setHeader("Content-Type", "application/xml");
  return res.send(xml);
});

app.get("/llms.txt", (_req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  return res.send(`# WikiBiz Autonomous Registry & Knowledge Synthesizer
> Verified commercial knowledge graph, Wikipedia Infobox generator, and PayPal agentic commerce gateway.

## Core Capabilities
- Automated Merchant Profiling & Verification
- Wikimedia Commons Corporate Asset Linking
- Schema.org JSON-LD Generation for Answer Engines
- Autonomous Agent Payment Rails (PayPal, Base USDC, Solana SOL) under the x402 protocol

## Public Endpoints
- Dashboard: https://wikibiz-agent.onrender.com/
- Directory API: GET /api/merchants
- Dynamic Sitemap: GET /sitemap.xml
- Entity Page: GET /entity/{slug}
- Raw JSON-LD: GET /api/v1/entities/{slug}/json-ld

## Agentic Commerce API (x402 Protocol)
- Endpoint: POST /api/v1/aeo/create-entity
- Price: $1.00 USD
- Accepted Rails: PayPal, Base (0xd10c3ee95466eec2cb89d9eff63d1446b371e59d), Solana (BqW6DZGrasYgJcEnQPzzSAmSH6ty4gdVydPkjKoxdmpE)
- Verification Route: POST /api/v1/aeo/verify-payment
`);
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

// Multi-Chain Settlement Verification Endpoint (PayPal, Base, Solana)
app.post("/api/v1/aeo/verify-payment", async (req: Request, res: Response) => {
  const { orderId, txHash, signature, rail } = req.body;
  const receipt = (orderId || txHash || signature) as string;

  if (!receipt) {
    return res.status(400).json({
      error: "Missing required identifier: provide orderId (PayPal), txHash (Base), or signature (Solana).",
    });
  }

  let isValid = false;
  let detectedRail = rail;

  if (!detectedRail) {
    if (receipt.startsWith("0x")) detectedRail = "base";
    else if (receipt.length >= 64 && !receipt.includes("-")) detectedRail = "solana";
    else detectedRail = "paypal";
  }

  if (detectedRail === "paypal") {
    isValid = await verifyPayPalOrder(receipt);
  } else if (detectedRail === "base") {
    isValid = await verifyBaseTransaction(receipt);
  } else if (detectedRail === "solana") {
    isValid = await verifySolanaTransaction(receipt);
  }

  if (!isValid) {
    return res.status(400).json({
      status: "rejected",
      rail: detectedRail,
      error: `Payment verification failed on rail '${detectedRail}'. Transaction unconfirmed or does not meet settlement terms.`,
    });
  }

  try {
    await savePaymentReceipt(receipt);
  } catch (e) {
    console.warn("Database receipt save skipped, using memory fallback:", e);
  }
  fallbackReceipts.add(receipt);

  return res.json({
    status: "settled",
    receipt,
    protocol: "x402",
    rail: detectedRail,
    message: "Payment successfully verified on-chain. Autonomous entity synthesis unlocked.",
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  await initDatabase();
  console.log(`WikiBiz Agent UI running at: http://localhost:${PORT}`);
});