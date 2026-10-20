<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="2.0" 
                xmlns:html="http://www.w3.org/TR/REC-html40"
                xmlns:sitemap="http://www.sitemaps.org/schemas/sitemap/0.9"
                xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="html" version="1.0" encoding="UTF-8" indent="yes"/>
  <xsl:template match="/">
    <html lang="en">
      <head>
        <title>WikiBiz XML Sitemap Directory</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 40px 20px; }
          .container { max-width: 900px; margin: 0 auto; background: #1e293b; border-radius: 12px; padding: 32px; border: 1px solid #334155; box-shadow: 0 10px 25px rgba(0,0,0,0.3); }
          h1 { margin: 0 0 8px; font-size: 1.5rem; color: #38bdf8; display: flex; align-items: center; gap: 10px; }
          p.desc { margin: 0 0 24px; color: #94a3b8; font-size: 0.9rem; }
          table { width: 100%; border-collapse: collapse; text-align: left; }
          th { padding: 12px; border-bottom: 2px solid #334155; color: #cbd5e1; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; }
          td { padding: 14px 12px; border-bottom: 1px solid #334155; font-size: 0.875rem; color: #e2e8f0; }
          tr:hover td { background: #334155; }
          a { color: #38bdf8; text-decoration: none; word-break: break-all; }
          a:hover { text-decoration: underline; }
          .badge { display: inline-block; padding: 2px 8px; border-radius: 6px; font-size: 0.75rem; font-weight: 600; background: #0284c7; color: #ffffff; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>WikiBiz Dynamic XML Sitemap</h1>
          <p class="desc">Autonomous Knowledge Graph Registry for Answer Engine Optimization (AEO). Fully crawlable by Perplexity, Google, ChatGPT, and Claude.</p>
          <table>
            <thead>
              <tr>
                <th>Resource URL</th>
                <th>Priority</th>
                <th>Frequency</th>
              </tr>
            </thead>
            <tbody>
              <xsl:for-each select="sitemap:urlset/sitemap:url">
                <tr>
                  <td>
                    <a target="_blank">
                      <xsl:attribute name="href">
                        <xsl:value-of select="sitemap:loc"/>
                      </xsl:attribute>
                      <xsl:value-of select="sitemap:loc"/>
                    </a>
                  </td>
                  <td><span class="badge"><xsl:value-of select="sitemap:priority"/></span></td>
                  <td><xsl:value-of select="sitemap:changefreq"/></td>
                </tr>
              </xsl:for-each>
            </tbody>
          </table>
        </div>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>