import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "wikibiz-wiki-server",
  version: "1.0.0",
});

// Tool 1: Generate Standard MediaWiki Entry & HTML Preview Card
server.tool(
  "generate_wiki_entity",
  {
    companyName: z.string().describe("Company or entity name"),
    founder: z.string().describe("Founder or key executive"),
    location: z.string().describe("Standardized geographical location"),
    employeeCount: z.number().describe("Total headcount"),
    website: z.string().url().describe("Official website URL"),
    summary: z.string().describe("Executive business summary"),
    paypalCheckoutUrl: z.string().optional().describe("PayPal verification or checkout link"),
    commonsFile: z.string().optional().describe("Wikimedia Commons filename (e.g. File:Logo.svg)"),
    commonsLogoUrl: z.string().optional().describe("Direct image URL from Wikimedia Commons"),
  },
  async ({
    companyName,
    founder,
    location,
    employeeCount,
    website,
    summary,
    paypalCheckoutUrl,
    commonsFile,
    commonsLogoUrl,
  }) => {
    // Standard MediaWiki wikitext Infobox syntax
    const wikitext = `{{Infobox company
| name             = ${companyName}
| logo             = ${commonsFile || ""}
| logo_caption     = Verified Wikimedia Commons Corporate Insignia
| type             = Verified Merchant
| founded          = Active
| founder          = ${founder}
| location         = ${location}
| num_employees    = ${employeeCount}
| website          = [${website} ${website}]
| verification     = Active & Registered
| checkout_gateway = ${paypalCheckoutUrl || "Pending Settle"}
}}

'''${companyName}''' is a registered commercial business entity headquartered in ${location}. 

== Overview ==
${summary}

== Merchant Verification & Commerce ==
This entity maintains machine-verifiable operational status. Direct checkout and badge settlement are enabled via PayPal agentic settlement: [${paypalCheckoutUrl || website} Payment Link].
`;

    // Visual HTML preview card for AG Grid modal / frontend view
    const htmlPreview = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; border: 1px solid #a2a9b1; background-color: #f8f9fa; padding: 16px; border-radius: 8px; max-width: 480px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
  ${
    commonsLogoUrl
      ? `<div style="text-align: center; margin-bottom: 14px; background: white; padding: 8px; border-radius: 4px; border: 1px solid #e2e8f0;">
           <img src="${commonsLogoUrl}" alt="${companyName} Insignia" style="max-height: 80px; max-width: 220px; object-fit: contain;" />
         </div>`
      : ""
  }
  <h2 style="margin: 0 0 8px 0; font-size: 1.35rem; color: #1e293b; border-bottom: 2px solid #0284c7; padding-bottom: 4px;">${companyName}</h2>
  <div style="font-size: 0.85rem; color: #64748b; margin-bottom: 12px;"><strong>Status:</strong> <span style="color: #16a34a; font-weight: 600;">Active & Verified</span></div>
  <table style="width: 100%; font-size: 0.875rem; border-collapse: collapse;">
    <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 6px 0; color: #475569;"><strong>Founder</strong></td><td style="padding: 6px 0; color: #0f172a;">${founder}</td></tr>
    <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 6px 0; color: #475569;"><strong>Location</strong></td><td style="padding: 6px 0; color: #0f172a;">${location}</td></tr>
    <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 6px 0; color: #475569;"><strong>Employees</strong></td><td style="padding: 6px 0; color: #0f172a;">${employeeCount}</td></tr>
    <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 6px 0; color: #475569;"><strong>Official Web</strong></td><td style="padding: 6px 0;"><a href="${website}" target="_blank" style="color: #0284c7; text-decoration: none;">${website}</a></td></tr>
  </table>
  <div style="margin-top: 14px; font-size: 0.875rem; color: #334155; line-height: 1.4;">
    <strong>Summary:</strong> ${summary}
  </div>
  ${
    paypalCheckoutUrl
      ? `<div style="margin-top: 16px; text-align: center;">
           <a href="${paypalCheckoutUrl}" target="_blank" style="display: inline-block; background-color: #0070ba; color: white; padding: 8px 16px; border-radius: 20px; font-size: 0.825rem; font-weight: 600; text-decoration: none;">Verified PayPal Rail</a>
         </div>`
      : ""
  }
</div>`;

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ wikitext, htmlPreview }, null, 2),
        },
      ],
    };
  }
);

// Tool 2: Answer Engine Optimization (AEO) JSON-LD Schema Synthesizer
server.tool(
  "generate_aeo_entity_payload",
  {
    companyName: z.string().describe("Legal name of company"),
    founder: z.string().describe("Founder name"),
    location: z.string().describe("Operating location"),
    employeeCount: z.number().describe("Headcount"),
    website: z.string().url().describe("Official website"),
    summary: z.string().describe("Executive business summary"),
    commonsLogoUrl: z.string().optional().describe("Direct URL of the verified logo"),
  },
  async ({ companyName, founder, location, employeeCount, website, summary, commonsLogoUrl }) => {
    const schemaJsonLd = {
      "@context": "https://schema.org",
      "@type": "Corporation",
      name: companyName,
      url: website,
      description: summary,
      ...(commonsLogoUrl && { logo: commonsLogoUrl }),
      founder: {
        "@type": "Person",
        name: founder,
      },
      address: {
        "@type": "PostalAddress",
        addressLocality: location,
      },
      numberOfEmployees: {
        "@type": "QuantitativeValue",
        value: employeeCount,
      },
      sameAs: [website, commonsLogoUrl].filter(Boolean),
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ schemaJsonLd }, null, 2),
        },
      ],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);