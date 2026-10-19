import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as cheerio from "cheerio";
import axios from "axios";

// Instantiate the MCP server
const server = new McpServer({
  name: "wikibiz-discovery-server",
  version: "1.0.0",
});

// Tool 1: Extract company identity, metadata, and site content
server.tool(
  "extract_merchant_profile",
  {
    companyName: z.string().describe("Legal or brand name of the business"),
    websiteUrl: z.string().url().describe("Official website URL"),
    founderName: z.string().optional().describe("Name of the founder/owner"),
  },
  async ({ companyName, websiteUrl, founderName }) => {
    try {
      const response = await axios.get(websiteUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (WikiBizBot/1.0)" },
        timeout: 8000,
      });

      const $ = cheerio.load(response.data);
      const metaDescription = $('meta[name="description"]').attr("content") || "";
      const pageTitle = $("title").text() || companyName;

      // Extract raw body text and clean whitespace
      const bodyText = $("body").text().replace(/\s+/g, " ").slice(0, 5000);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: "success",
                companyName,
                founder: founderName ?? "Unknown / Sole Proprietor",
                website: websiteUrl,
                title: pageTitle.trim(),
                summary: metaDescription || bodyText.slice(0, 300),
                scrapedSnippet: bodyText.slice(0, 1000),
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: "fallback",
                companyName,
                website: websiteUrl,
                founder: founderName ?? "Pending Verification",
                summary: `${companyName} digital entity profile.`,
                note: `Automated scrape hit: ${error.message}. Entity seeded with defaults.`,
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

// Tool 2: Structure location, employee metrics, and enterprise categorization
server.tool(
  "resolve_business_metrics",
  {
    location: z.string().describe("City, region, or address"),
    claimedEmployees: z.number().describe("Stated or estimated number of employees"),
  },
  async ({ location, claimedEmployees }) => {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              standardizedLocation: location.trim(),
              employeeCount: claimedEmployees,
              headcountBracket:
                claimedEmployees <= 10
                  ? "Micro-Enterprise (1-10)"
                  : claimedEmployees <= 50
                  ? "Small Enterprise (11-50)"
                  : "Mid-Market Enterprise (51+)",
              verifiedTimestamp: new Date().toISOString(),
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// Connect via standard I/O transport
const transport = new StdioServerTransport();
await server.connect(transport);