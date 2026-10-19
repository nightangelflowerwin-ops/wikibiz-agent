import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as fs from "fs";
import * as path from "path";

async function runDelegationWorkflow() {
  console.log("=== 1. Booting MCP Servers ===");

  // Client 1: Discovery MCP
  const discoveryTransport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "src/discovery-mcp.ts"],
  });
  const discoveryClient = new Client({ name: "orchestrator", version: "1.0.0" }, { capabilities: {} });
  await discoveryClient.connect(discoveryTransport);

  // Client 2: PayPal MCP
  const paypalTransport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "src/paypal-mcp.ts"],
  });
  const paypalClient = new Client({ name: "orchestrator", version: "1.0.0" }, { capabilities: {} });
  await paypalClient.connect(paypalTransport);

  // Client 3: Wiki MCP
  const wikiTransport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "src/wiki-mcp.ts"],
  });
  const wikiClient = new Client({ name: "orchestrator", version: "1.0.0" }, { capabilities: {} });
  await wikiClient.connect(wikiTransport);

  // Intent payload matching the audio note parameters
  const userInput = {
    companyName: "Savanna Roast Coffee",
    website: "https://example.com",
    founder: "Alex Ndung'u",
    location: "Machakos, Kenya",
    claimedEmployees: 18,
  };

  console.log("\n=== 2. Delegating to Merchant Discovery MCP ===");
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
      claimedEmployees: userInput.claimedEmployees,
    },
  });
  const metricsData = JSON.parse(metricsRes.content[0].text);

  console.log("Discovery Complete: Categorized as", metricsData.headcountBracket);

  console.log("\n=== 3. Delegating to PayPal Agentic MCP ===");
  let checkoutUrl: string | undefined;
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
    checkoutUrl = payData.checkoutUrl;
    console.log("PayPal Checkout Link Created:", checkoutUrl || "Sandbox mock generated");
  } catch (err) {
    console.warn("PayPal call failed (check .env credentials); continuing pipeline...");
  }

  console.log("\n=== 4. Delegating to Wiki Entity MCP ===");
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

  // Write the output to an HTML preview file
  const outPath = path.resolve("wiki_entity_preview.html");
  fs.writeFileSync(outPath, wikiData.htmlPreview);

  console.log("\n=== Final Wiki Entity Generated ===");
  console.log(wikiData.wikitext);
  console.log(`\nHTML preview saved to: ${outPath}`);

  process.exit(0);
}

runDelegationWorkflow().catch((err) => {
  console.error("Delegation Workflow Error:", err);
  process.exit(1);
});