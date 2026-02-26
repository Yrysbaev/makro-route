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

function getAuthClient() {
  const clientEmail = requiredEnv("GOOGLE_SHEETS_CLIENT_EMAIL");
  const privateKey = requiredEnv("GOOGLE_SHEETS_PRIVATE_KEY").replace(
    /\\n/g,
    "\n",
  );

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
