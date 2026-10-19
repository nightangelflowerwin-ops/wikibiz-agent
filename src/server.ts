import express from "express";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as path from "path";

const app = express();
app.use(express.json());
app.use(express.static("public"));

// In-memory registry of created entities for AG Grid
const merchantRegistry: any[] = [];

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

  // 1. Discovery
  const profileRes: any = await discoveryClient.callTool({
    name: "extract_merchant_profile",
    arguments: {
      companyName: userInput.companyName,
      websiteUrl: userInput.website,
      founderName: userInput.founder,
    },
  });
  const profileData = JSON.parse(profileRes.content[0].text);

  const metricsRes: any = await discoveryClient.callTool({
    name: "resolve_business_metrics",
    arguments: {
      location: userInput.location,
      claimedEmployees: Number(userInput.claimedEmployees),
    },
  });
  const metricsData = JSON.parse(metricsRes.content[0].text);

  // 2. PayPal Agentic Link
  let checkoutUrl = "";
  try {
    const payRes: any = await paypalClient.callTool({
      name: "create_merchant_payment_link",
      arguments: {
        companyName: userInput.companyName,
        unitAmount: "15.00",
        currency: "USD",
        memo: "Merchant Profile Verification Badge",
      },
    });
    const payData = JSON.parse(payRes.content[0].text);
    checkoutUrl = payData.checkoutUrl || "#";
  } catch (e) {
    checkoutUrl = "https://sandbox.paypal.com";
  }

  // 3. Wiki Entity
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
    },
  });
  const wikiData = JSON.parse(wikiRes.content[0].text);

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
  };

  merchantRegistry.unshift(record);
  return record;
}

// API Routes
app.get("/api/merchants", (req, res) => {
  res.json(merchantRegistry);
});

app.post("/api/create-entity", async (req, res) => {
  try {
    const record = await delegateAgentTask(req.body);
    res.json({ success: true, record });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`WikiBiz Agent UI running at: http://localhost:${PORT}`);
});