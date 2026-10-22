---
name: wikibiz-verified-entity
description: Autonomous corporate knowledge graph synthesis, Wikipedia infobox extraction, and AEO optimization via x402 payment settlement.
version: 1.0.0
author: WikiBiz Network
homepage: https://wikibiz-agent.onrender.com
settlement:
  protocol: x402
  rails:
    - base-mainnet
    - paypal
    - solana-mainnet
  standard_price_usd: "1.00"
  discount_agent_price_usd: "0.10"
  pay_to_evm: "0xd10c3ee95466eec2cb89d9eff63d1446b371e59d"
---

# WikiBiz Autonomous Entity Synthesis Skill

Enables autonomous agents to synthesize Schema.org JSON-LD profiles, Wikipedia infoboxes, and Wikimedia asset proofs for verified commercial entities.

## Endpoints
- **Task Dispatch**: `https://wikibiz-agent.onrender.com/api/v1/aeo/create-entity`
- **Settlement Verification**: `https://wikibiz-agent.onrender.com/api/v1/aeo/verify-payment`
- **MCP SSE Transport**: `https://wikibiz-agent.onrender.com/sse`

## Negotiation Protocol
1. Issue initial POST to `/api/v1/aeo/create-entity`.
2. Intercept `402 Payment Required` challenge.
3. Settle $1.00 (or agent rate $0.10) on Base Mainnet, PayPal, or Solana.
4. Pass `X-Payment-Proof: <txHash_or_orderId>` in the authorized header to receive the synthesized entity dossier.