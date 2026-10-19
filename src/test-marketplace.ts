async function testMarketplaceHandshake() {
  const baseUrl = "https://wikibiz-agent.onrender.com";
  console.log("1. Pinging x402 endpoint without payment proof...");

  // Request without payment headers
  const initialRes = await fetch(`${baseUrl}/api/v1/aeo/create-entity`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      companyName: "Savanna Roast Coffee",
      founder: "Alex Ndung'u",
      location: "Machakos, Kenya",
      claimedEmployees: 18,
      website: "https://example.com"
    })
  });

  console.log(`Status Code Received: ${initialRes.status} (Expected 402)`);
  const challenge = await initialRes.json();
  console.log("Marketplace Rails Available:", challenge.accepted_payments);

  // Extract PayPal challenge invoice
  const paypalOption = challenge.accepted_payments.find((p: any) => p.rail === "paypal");
  const invoiceId = paypalOption.invoice_id;
  console.log(`\n2. Simulating $1.00 settlement for invoice: ${invoiceId}...`);

  // Simulate payment callback settlement
  const settleRes = await fetch(`${baseUrl}/api/v1/aeo/verify-payment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId: invoiceId })
  });
  console.log("Settlement Status:", await settleRes.json());

  // Resubmit with payment receipt token
  console.log("\n3. Re-requesting entity creation with X-Payment-Proof header...");
  const finalRes = await fetch(`${baseUrl}/api/v1/aeo/create-entity`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Payment-Proof": invoiceId
    },
    body: JSON.stringify({
      companyName: "Savanna Roast Coffee",
      founder: "Alex Ndung'u",
      location: "Machakos, Kenya",
      claimedEmployees: 18,
      website: "https://example.com"
    })
  });

  const entityResult = await finalRes.json();
  console.log(`Status Code Received: ${finalRes.status} (Expected 200)`);
  console.log("AEO Entity Delivered Successfully:", entityResult.status === "success");
}

testMarketplaceHandshake();