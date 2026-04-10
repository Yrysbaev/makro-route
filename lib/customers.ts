import customersData from "./customers-data.json";
import { getTabName, readSheetRows } from "./google-sheets";

export type Customer = {
  id: string;
  name: string;
  addressLine1: string;
  city: string;
  state: string;
  country: string;
  zip: string;
};

const SHEETS_READ_TIMEOUT_MS = 90_000;

export async function loadCustomers(): Promise<Customer[]> {
  try {
    const rows = await Promise.race([
      readSheetRows(getTabName("customers")),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error("Google Sheets read timed out")),
          SHEETS_READ_TIMEOUT_MS,
        );
      }),
    ]);
    const customers = rows
      .map((row, index) => {
        const name = row.name || row["Company name"] || row.company_name || "";
        const addressLine1 =
          row.address_line1 || row["Street Address"] || row.street_address || "";
        const city = row.city || row.City || "";
        const state = row.state || row.State || "";
        const country = row.country || row.Country || "";
        const zip = row.zip || row.Zip || "";
        const id =
          row.customer_id ||
          row.id ||
          `customer-${index + 1}`;

        if (!name || !addressLine1) {
          return null;
        }

        return {
          id,
          name,
          addressLine1,
          city,
          state,
          country,
          zip,
        } satisfies Customer;
      })
      .filter((row): row is Customer => row !== null);

    if (customers.length > 0) {
      return customers;
    }
  } catch {
    // Keep app usable before Google Sheets env is configured.
  }

  return customersData as Customer[];
}
