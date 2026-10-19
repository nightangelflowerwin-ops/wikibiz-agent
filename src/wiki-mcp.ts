import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "wikibiz-wiki-server",
  version: "1.0.0",
});

server.tool(
  "generate_wiki_entity",
  {
    companyName: z.string().describe("Company or merchant name"),
    founder: z.string().describe("Founder / Owner"),
    location: z.string().describe("Headquarters location"),
    employeeCount: z.number().describe("Headcount"),
    website: z.string().url().describe("Official website"),
    summary: z.string().describe("Short descriptive bio"),
    paypalCheckoutUrl: z.string().optional().describe("Generated PayPal payment link"),
  },
  async ({
    companyName,
    founder,
    location,
    employeeCount,
    website,
    summary,
    paypalCheckoutUrl,
  }) => {
    // Generate authentic Wikipedia/MediaWiki markup
    const wikitext = `{{Infobox company
| name             = ${companyName}
| founder          = ${founder}
| location_city    = ${location}
| num_employees    = ${employeeCount}
| website          = [${website} Official Website]
| paypal_verified  = ${paypalCheckoutUrl ? "Yes" : "Pending"}
}}

'''${companyName}''' is a business enterprise founded by ${founder}, headquartered in ${location}. 

== Overview ==
${summary}

== Operations & Metrics ==
The company currently operates with approximately ${employeeCount} employees. 

${
  paypalCheckoutUrl
    ? `== Agentic Commerce & Verification ==\nThis merchant entity is registered for autonomous payments via PayPal. [${paypalCheckoutUrl} Support / Transact via PayPal].`
    : ""
}

== References ==
{{reflist}}
`;

    // Render lightweight HTML preview representation
    const htmlPreview = `
<div style="font-family: sans-serif; max-width: 750px; border: 1px solid #a2a9b1; padding: 20px; background: #fff;">
  <h1 style="border-bottom: 1px solid #a2a9b1; font-family: serif; font-size: 28px;">${companyName}</h1>
  <div style="float: right; border: 1px solid #a2a9b1; background-color: #f8f9fa; padding: 12px; width: 280px; margin-left: 20px;">
    <h3 style="text-align: center; margin-top: 0;">${companyName}</h3>
    <table style="width: 100%; font-size: 13px;">
      <tr><td><b>Founder:</b></td><td>${founder}</td></tr>
      <tr><td><b>Location:</b></td><td>${location}</td></tr>
      <tr><td><b>Employees:</b></td><td>${employeeCount}</td></tr>
      <tr><td><b>Website:</b></td><td><a href="${website}">${website}</a></td></tr>
      ${
        paypalCheckoutUrl
          ? `<tr><td><b>PayPal:</b></td><td><a href="${paypalCheckoutUrl}" style="color: #0070ba; font-weight: bold;">Verified Merchant</a></td></tr>`
          : ""
      }
    </table>
  </div>
  <p><b>${companyName}</b> is an enterprise founded by ${founder}, based in ${location}.</p>
  <h3>Overview</h3>
  <p>${summary}</p>
  ${
    paypalCheckoutUrl
      ? `<div style="background: #eaf3ff; border: 1px solid #0070ba; border-radius: 4px; padding: 10px; margin-top: 15px;">
           <span style="color: #0070ba; font-weight: bold;">✓ PayPal Agentic Commerce Activated</span>
           <br><a href="${paypalCheckoutUrl}" target="_blank" style="display: inline-block; margin-top: 6px; background: #0070ba; color: white; padding: 6px 14px; text-decoration: none; border-radius: 4px; font-size: 13px;">Complete Payment / Verify</a>
         </div>`
      : ""
  }
</div>
`;

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              status: "success",
              wikitext,
              htmlPreview,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);
// Tool: AEO Entity Generator (Schema.org JSON-LD & Answer Engine Optimization)
server.tool(
  "generate_aeo_entity_payload",
  {
    companyName: z.string(),
    founder: z.string(),
    location: z.string(),
    employeeCount: z.number(),
    website: z.string().url(),
    summary: z.string(),
  },
  async ({ companyName, founder, location, employeeCount, website, summary }) => {
    const schemaJsonLd = {
      "@context": "https://schema.org",
      "@type": "Corporation",
      "name": companyName,
      "url": website,
      "description": summary,
      "founder": {
        "@type": "Person",
        "name": founder,
      },
      "address": {
        "@type": "PostalAddress",
        "addressLocality": location,
      },
      "numberOfEmployees": {
        "@type": "QuantitativeValue",
        "value": employeeCount,
      },
      "knowsAbout": ["Agentic Commerce", "Verified Enterprise"],
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              schemaJsonLd,
              aeoOptimized: true,
              semanticFingerprint: `urn:entity:${companyName.toLowerCase().replace(/\s+/g, "-")}`,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);