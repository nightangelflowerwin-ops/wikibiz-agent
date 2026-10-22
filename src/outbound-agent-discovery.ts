import { ethers } from "ethers";

interface AgentCard {
  name: string;
  description: string;
  url?: string;
  endpoints?: {
    task?: string;
    verify?: string;
  };
  acceptedRails?: string[];
}

// Seed list of known peer agent domains or directories
const TARGET_PEER_DOMAINS = [
  "https://wikibiz-agent.onrender.com",
  // Add other peer agent URLs, test agents, or partner gateways here
];

async function fetchAgentManifest(baseUrl: string): Promise<AgentCard | null> {
  const cleanUrl = baseUrl.replace(/\/$/, "");
  const manifestCandidates = [
    `${cleanUrl}/.well-known/agent.json`,
    `${cleanUrl}/.well-known/mcp.json`,
    `${cleanUrl}/openapi.json`
  ];

  for (const candidate of manifestCandidates) {
    try {
      const res = await fetch(candidate, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        console.log(`[Discovery] Located agent manifest at: ${candidate}`);
        const data = await res.json();
        return {
          name: data.name || data.info?.title || "Unknown Agent",
          description: data.description || data.info?.description || "",
          url: cleanUrl,
          endpoints: {
            task: `${cleanUrl}/api/v1/aeo/create-entity`,
            verify: `${cleanUrl}/api/v1/aeo/verify-payment`
          }
        };
      }
    } catch {
      // Continue checking next candidate
    }
  }

  return null;
}

async function dispatchOutboundHandshake(peer: AgentCard) {
  console.log(`\n--- Initiating Outbound Handshake with Peer: ${peer.name} (${peer.url}) ---`);

  const payload = {
    companyName: "Autonomous Partner Mesh",
    website: "https://wikibiz.org",
    founder: "A2A Outreach Daemon",
    location: "Wilmington, DE",
    claimedEmployees: 10
  };

  const endpoint = peer.endpoints?.task;
  if (!endpoint) return;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    console.log(`[Outreach] Target response code: ${res.status}`);

    if (res.status === 402) {
      const challenge = await res.json();
      console.log(`[Outreach] Peer challenged request with x402 payment:`, challenge);
      console.log(`[Outreach] Settlement terms acknowledged. Handshake valid.`);
    } else if (res.status === 200) {
      const responseData = await res.json();
      console.log(`[Outreach] Peer fulfilled request directly:`, responseData);
    } else {
      console.warn(`[Outreach] Peer returned unexpected status: ${res.status}`);
    }
  } catch (err: any) {
    console.error(`[Outreach Error] Failed to contact ${peer.url}:`, err.message);
  }
}

async function runAutonomousOutreach() {
  console.log(`[Discovery Engine] Scanning ${TARGET_PEER_DOMAINS.length} peer candidate domains...`);

  for (const domain of TARGET_PEER_DOMAINS) {
    const manifest = await fetchAgentManifest(domain);
    if (manifest) {
      await dispatchOutboundHandshake(manifest);
    } else {
      console.warn(`[Discovery] No valid manifest found on domain: ${domain}`);
    }
  }
}

runAutonomousOutreach().catch((err) => {
  console.error("Discovery engine run failure:", err);
});