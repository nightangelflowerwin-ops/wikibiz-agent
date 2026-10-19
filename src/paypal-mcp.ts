import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const server = new McpServer({
  name: "wikibiz-paypal-server",
  version: "1.0.0",
});

const PAYPAL_BASE_URL =
  process.env.PAYPAL_ENV === "production"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";

async function getAccessToken(): Promise<string> {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET in environment variables.");
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await axios.post(
    `${PAYPAL_BASE_URL}/v1/oauth2/token`,
    "grant_type=client_credentials",
    {
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );
  return res.data.access_token;
}

// Tool: Generate an autonomous agent-ready PayPal Checkout Link
server.tool(
  "create_merchant_payment_link",
  {
    companyName: z.string().describe("Name of the company or merchant"),
    unitAmount: z.string().describe("Amount in decimal format, e.g. '25.00'"),
    currency: z.string().default("USD").describe("ISO 3-letter currency code, e.g. USD, EUR"),
    memo: z.string().describe("Description of product, service, or verification badge"),
  },
  async ({ companyName, unitAmount, currency, memo }) => {
    try {
      const token = await getAccessToken();

      const orderPayload = {
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: `ENTITY_${Date.now()}`,
            description: `${companyName} - ${memo}`,
            amount: {
              currency_code: currency,
              value: unitAmount,
            },
          },
        ],
        application_context: {
          brand_name: companyName,
          user_action: "PAY_NOW",
          return_url: "https://example.com/wiki/success",
          cancel_url: "https://example.com/wiki/cancel",
        },
      };

      const orderRes = await axios.post(
        `${PAYPAL_BASE_URL}/v2/checkout/orders`,
        orderPayload,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );

      const approvalUrl = orderRes.data.links?.find(
        (link: any) => link.rel === "approve"
      )?.href;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: "created",
                orderId: orderRes.data.id,
                checkoutUrl: approvalUrl,
                currency,
                amount: unitAmount,
                memo,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err: any) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: "error",
                error: err.response?.data || err.message,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  }
);

// Connect via standard I/O transport
const transport = new StdioServerTransport();
await server.connect(transport);