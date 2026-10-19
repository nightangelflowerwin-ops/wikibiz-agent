import pg from "pg";
const { Pool } = pg;

// Connection strings
const primaryUrl = process.env.DATABASE_URL; // Render PostgreSQL
const fallbackUrl = process.env.SUPABASE_DATABASE_URL; // Supabase PostgreSQL

let activePool: pg.Pool | null = null;

export async function initDatabase() {
  // 1. Try Primary (Render Postgres)
  if (primaryUrl) {
    try {
      const primaryPool = new Pool({
        connectionString: primaryUrl,
        ssl: primaryUrl.includes("localhost") ? false : { rejectUnauthorized: false },
        connectionTimeoutMillis: 5000,
      });

      // Test connection
      await primaryPool.query("SELECT 1;");
      console.log("Connected successfully to Primary Database (Render PostgreSQL).");
      activePool = primaryPool;
    } catch (err: any) {
      console.warn("Render PostgreSQL unavailable or expired. Checking fallback...", err.message);
    }
  }

  // 2. If Primary failed or missing, try Fallback (Supabase)
  if (!activePool && fallbackUrl) {
    try {
      const fallbackPool = new Pool({
        connectionString: fallbackUrl,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 5000,
      });

      await fallbackPool.query("SELECT 1;");
      console.log("Connected successfully to Fallback Database (Supabase PostgreSQL).");
      activePool = fallbackPool;
    } catch (err: any) {
      console.warn("Supabase connection failed:", err.message);
    }
  }

  // 3. Ensure tables exist if an active database pool was established
  if (activePool) {
    await createTables(activePool);
  } else {
    console.warn("No persistent database available. Operating in in-memory mode.");
  }
}

async function createTables(pool: pg.Pool) {
  const createQuery = `
    CREATE TABLE IF NOT EXISTS merchant_entities (
      id VARCHAR(64) PRIMARY KEY,
      company_name TEXT NOT NULL,
      founder TEXT,
      location TEXT,
      employees INTEGER,
      bracket TEXT,
      website TEXT,
      status TEXT,
      checkout_url TEXT,
      wikitext TEXT,
      html_preview TEXT,
      schema_json_ld JSONB,
      commons_logo TEXT,
      commons_license TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS payment_receipts (
      receipt_id VARCHAR(128) PRIMARY KEY,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `;
  await pool.query(createQuery);
}

// Database Operations
export async function saveMerchantEntity(record: any) {
  if (!activePool) return record;

  const query = `
    INSERT INTO merchant_entities (
      id, company_name, founder, location, employees, bracket,
      website, status, checkout_url, wikitext, html_preview,
      schema_json_ld, commons_logo, commons_license
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    ON CONFLICT (id) DO UPDATE SET
      company_name = EXCLUDED.company_name,
      schema_json_ld = EXCLUDED.schema_json_ld;
  `;

  const values = [
    record.id,
    record.companyName,
    record.founder,
    record.location,
    record.employees,
    record.bracket,
    record.website,
    record.status,
    record.checkoutUrl,
    record.wikitext,
    record.htmlPreview,
    record.schemaJsonLd ? JSON.stringify(record.schemaJsonLd) : null,
    record.commonsLogo,
    record.commonsLicense,
  ];

  await activePool.query(query, values);
  return record;
}

export async function fetchAllMerchants(): Promise<any[]> {
  if (!activePool) return [];

  const res = await activePool.query(`
    SELECT 
      id,
      company_name as "companyName",
      founder,
      location,
      employees,
      bracket,
      website,
      status,
      checkout_url as "checkoutUrl",
      wikitext,
      html_preview as "htmlPreview",
      schema_json_ld as "schemaJsonLd",
      commons_logo as "commonsLogo",
      commons_license as "commonsLicense"
    FROM merchant_entities 
    ORDER BY created_at DESC;
  `);

  return res.rows;
}

export async function savePaymentReceipt(receipt: string) {
  if (!activePool) return;
  await activePool.query(
    "INSERT INTO payment_receipts (receipt_id) VALUES ($1) ON CONFLICT DO NOTHING;",
    [receipt]
  );
}

export async function checkPaymentReceipt(receipt: string): Promise<boolean> {
  if (!activePool) return false;
  const res = await activePool.query(
    "SELECT 1 FROM payment_receipts WHERE receipt_id = $1;",
    [receipt]
  );
  return (res.rowCount ?? 0) > 0;
}

// Slug Generator for Search & AI Crawlers
export function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\w\-]+/g, "")
    .replace(/\-\-+/g, "-");
}

// Entity Lookup by Slug or ID
export async function fetchMerchantBySlug(slug: string): Promise<any | null> {
  const all = await fetchAllMerchants();
  return (
    all.find(
      (m) =>
        slugify(m.companyName) === slug ||
        m.id.toLowerCase() === slug.toLowerCase()
    ) || null
  );
}