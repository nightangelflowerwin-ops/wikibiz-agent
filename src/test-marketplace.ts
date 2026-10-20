const BASE_URL = "https://wikibiz-agent.onrender.com";

async function runTests() {
  console.log("=== 1. Testing Discovery & Manifest Endpoints ===");
  const mcpRes = await fetch(`${BASE_URL}/.well-known/mcp.json`);
  console.log(`GET /.well-known/mcp.json -> Status: ${mcpRes.status}`);

  const openapiRes = await fetch(`${BASE_URL}/openapi.json`);
  console.log(`GET /openapi.json -> Status: ${openapiRes.status}`);

  const sitemapRes = await fetch(`${BASE_URL}/sitemap.xml`);
  console.log(`GET /sitemap.xml -> Status: ${sitemapRes.status}`);

  console.log("\n=== 2. Testing 402 Payment Challenge ===");
  const testPayload = {
    companyName: "Autonomous Robotics",
    website: "https://autorobotics.io",
    founder: "Elena Rostova",
    location: "Austin, TX",
    claimedEmployees: 15,
  };

  const challengeRes = await fetch(`${BASE_URL}/api/v1/aeo/create-entity`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(testPayload),
  });

  console.log(`POST /api/v1/aeo/create-entity -> Status: ${challengeRes.status}`);
  const challengeBody = await challengeRes.json();
  console.log("402 Response Body:", JSON.stringify(challengeBody, null, 2));

  console.log("\n=== 3. Testing Settlement Verification ===");
  const verifyRes = await fetch(`${BASE_URL}/api/v1/aeo/verify-payment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId: "PAYPAL-INV-SIM-2026-LIVE" }),
  });

  console.log(`POST /api/v1/aeo/verify-payment -> Status: ${verifyRes.status}`);
  const verifyBody = await verifyRes.json();
  console.log("Verification Response:", JSON.stringify(verifyBody, null, 2));

  console.log("\n=== 4. Resubmitting Entity with Payment Proof Header ===");
  const claimRes = await fetch(`${BASE_URL}/api/v1/aeo/create-entity`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Payment-Proof": "PAYPAL-INV-SIM-2026-LIVE",
    },
    body: JSON.stringify(testPayload),
  });

  console.log(`POST /api/v1/aeo/create-entity (with proof) -> Status: ${claimRes.status}`);
  const claimBody = await claimRes.json();
  console.log("Generated Dossier Result:", JSON.stringify(claimBody, null, 2));

  console.log("\n=== 5. Checking Live Slug Route ===");
  const slugRes = await fetch(`${BASE_URL}/entity/autonomous-robotics`);
  console.log(`GET /entity/autonomous-robotics -> Status: ${slugRes.status}`);
}

runTests().catch(console.error);