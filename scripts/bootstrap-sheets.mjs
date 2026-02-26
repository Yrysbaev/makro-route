import fs from "node:fs";
import path from "node:path";
import { google } from "googleapis";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(path.join(process.cwd(), ".env.local"));
loadEnvFile(path.join(process.cwd(), ".env"));

function requiredEnv(key) {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
}

const spreadsheetId = requiredEnv("GOOGLE_SHEETS_SPREADSHEET_ID");
const clientEmail = requiredEnv("GOOGLE_SHEETS_CLIENT_EMAIL");
const privateKey = requiredEnv("GOOGLE_SHEETS_PRIVATE_KEY").replace(/\\n/g, "\n");

const TAB_DEFS = [
  {
    key: "GOOGLE_SHEETS_TAB_CUSTOMERS",
    fallback: "customers",
    header: [
      "customer_id",
      "name",
      "address_line1",
      "city",
      "state",
      "country",
      "zip",
      "active",
    ],
  },
  {
    key: "GOOGLE_SHEETS_TAB_TRIPS",
    fallback: "trips",
    header: [
      "trip_id",
      "trip_date",
      "created_by",
      "started_at",
      "submitted_at",
      "status",
      "warehouse_address",
      "warehouse_lat",
      "warehouse_lng",
    ],
  },
  {
    key: "GOOGLE_SHEETS_TAB_TRIP_STOPS",
    fallback: "trip_stops",
    header: [
      "trip_id",
      "stop_id",
      "position",
      "customer_id",
      "customer_name",
      "address",
      "city",
      "state",
      "zip",
      "country",
      "status",
      "delivered_at",
      "skipped_reason",
      "updated_by",
      "updated_at",
    ],
  },
  {
    key: "GOOGLE_SHEETS_TAB_TRIP_EVENTS",
    fallback: "trip_events",
    header: ["event_id", "trip_id", "event_type", "payload_json", "actor", "created_at"],
  },
  {
    key: "GOOGLE_SHEETS_TAB_DELIVERY_HISTORY",
    fallback: "delivery_history",
    header: [
      "history_id",
      "trip_id",
      "trip_date",
      "customer_id",
      "customer_name",
      "status",
      "delivered_at",
      "skipped_reason",
      "driver",
      "submitted_at",
    ],
  },
];

function tabName(def) {
  return process.env[def.key] || def.fallback;
}

async function main() {
  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existingTitles = new Set(
    (meta.data.sheets || []).map((sheet) => sheet.properties?.title).filter(Boolean),
  );

  const missing = TAB_DEFS.map(tabName).filter((name) => !existingTitles.has(name));
  if (missing.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: missing.map((name) => ({
          addSheet: { properties: { title: name } },
        })),
      },
    });
    console.log(`Created tabs: ${missing.join(", ")}`);
  }

  for (const def of TAB_DEFS) {
    const name = tabName(def);
    const range = `${name}!A1:ZZ1`;
    const headerResp = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    const firstRow = headerResp.data.values?.[0] || [];
    const hasHeader = firstRow.some((cell) => String(cell || "").trim().length > 0);

    if (!hasHeader) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${name}!A1`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [def.header] },
      });
      console.log(`Initialized header in tab: ${name}`);
    } else {
      console.log(`Header exists in tab: ${name}`);
    }
  }

  // Seed customers from local JSON only if sheet has no data rows yet.
  const customersTab = tabName(TAB_DEFS[0]);
  const customersRange = `${customersTab}!A2:ZZ`;
  const customersResp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: customersRange,
  });
  const existingCustomerRows = customersResp.data.values || [];

  if (existingCustomerRows.length === 0) {
    const localPath = path.join(process.cwd(), "lib", "customers-data.json");
    if (fs.existsSync(localPath)) {
      const localCustomers = JSON.parse(fs.readFileSync(localPath, "utf8"));
      const values = localCustomers.map((customer) => [
        customer.id,
        customer.name,
        customer.addressLine1,
        customer.city,
        customer.state,
        customer.country,
        customer.zip,
        "true",
      ]);

      if (values.length > 0) {
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: `${customersTab}!A2`,
          valueInputOption: "USER_ENTERED",
          insertDataOption: "INSERT_ROWS",
          requestBody: { values },
        });
        console.log(`Seeded ${values.length} customers into ${customersTab}`);
      }
    }
  } else {
    console.log(`Customers tab already has ${existingCustomerRows.length} row(s), skip seeding.`);
  }

  console.log("Google Sheets bootstrap complete.");
}

main().catch((error) => {
  console.error("Bootstrap failed:", error.message);
  process.exit(1);
});
