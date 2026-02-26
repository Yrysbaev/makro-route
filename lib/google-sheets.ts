import { google, sheets_v4 } from "googleapis";

type SheetRow = Record<string, string>;

function requiredEnv(
  name:
    | "GOOGLE_SHEETS_CLIENT_EMAIL"
    | "GOOGLE_SHEETS_PRIVATE_KEY"
    | "GOOGLE_SHEETS_SPREADSHEET_ID",
): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function normalizePrivateKey(raw: string): string {
  let key = raw.trim();
  // Remove surrounding double quotes if pasted with them (e.g. in Vercel env form)
  if (key.startsWith('"') && key.endsWith('"')) {
    key = key.slice(1, -1).trim();
  }
  // Restore newlines when stored as literal \n (e.g. in Vercel env)
  key = key.replace(/\\n/g, "\n");
  // If key is one long line (newlines lost in env), re-format PEM so decoder accepts it
  if (!key.includes("\n") && key.includes("-----BEGIN")) {
    const begin = "-----BEGIN PRIVATE KEY-----";
    const end = "-----END PRIVATE KEY-----";
    const start = key.indexOf(begin) + begin.length;
    const finish = key.indexOf(end);
    if (start > begin.length && finish > start) {
      const base64 = key.slice(start, finish).replace(/\s/g, "");
      const lines = base64.match(/.{1,64}/g) ?? [];
      key = `${begin}\n${lines.join("\n")}\n${end}\n`;
    }
  }
  return key;
}

function getAuthClient() {
  const clientEmail = requiredEnv("GOOGLE_SHEETS_CLIENT_EMAIL");
  const privateKey = normalizePrivateKey(requiredEnv("GOOGLE_SHEETS_PRIVATE_KEY"));

  return new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

function getSheetsApi(): sheets_v4.Sheets {
  return google.sheets({
    version: "v4",
    auth: getAuthClient(),
  });
}

export function getSpreadsheetId(): string {
  return requiredEnv("GOOGLE_SHEETS_SPREADSHEET_ID");
}

export function getTabName(
  key:
    | "customers"
    | "trips"
    | "tripStops"
    | "tripEvents"
    | "deliveryHistory",
): string {
  const map = {
    customers: process.env.GOOGLE_SHEETS_TAB_CUSTOMERS ?? "customers",
    trips: process.env.GOOGLE_SHEETS_TAB_TRIPS ?? "trips",
    tripStops: process.env.GOOGLE_SHEETS_TAB_TRIP_STOPS ?? "trip_stops",
    tripEvents: process.env.GOOGLE_SHEETS_TAB_TRIP_EVENTS ?? "trip_events",
    deliveryHistory:
      process.env.GOOGLE_SHEETS_TAB_DELIVERY_HISTORY ?? "delivery_history",
  };
  return map[key];
}

function normalizeCell(value: unknown): string {
  return String(value ?? "").trim();
}

export async function readSheetRows(tabName: string): Promise<SheetRow[]> {
  const sheets = getSheetsApi();
  const spreadsheetId = getSpreadsheetId();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tabName}!A:ZZ`,
  });

  const values = response.data.values ?? [];
  if (values.length === 0) {
    return [];
  }

  const [headerRow, ...bodyRows] = values;
  const headers = headerRow.map((cell) => normalizeCell(cell));
  const rows: SheetRow[] = [];

  for (const row of bodyRows) {
    const mapped: SheetRow = {};
    for (let i = 0; i < headers.length; i += 1) {
      const header = headers[i];
      if (!header) {
        continue;
      }
      mapped[header] = normalizeCell(row[i]);
    }
    rows.push(mapped);
  }

  return rows;
}

export async function appendSheetRows(
  tabName: string,
  rows: string[][],
): Promise<void> {
  if (rows.length === 0) {
    return;
  }
  const sheets = getSheetsApi();
  const spreadsheetId = getSpreadsheetId();
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${tabName}!A:ZZ`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: rows,
    },
  });
}

export async function replaceSheetRows(
  tabName: string,
  header: string[],
  rows: string[][],
): Promise<void> {
  const sheets = getSheetsApi();
  const spreadsheetId = getSpreadsheetId();

  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${tabName}!A:ZZ`,
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tabName}!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [header, ...rows],
    },
  });
}
