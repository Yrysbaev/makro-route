import customersData from "./customers-data.json";

export type Customer = {
  id: string;
  name: string;
  addressLine1: string;
  city: string;
  state: string;
  country: string;
  zip: string;
};

export async function loadCustomers(): Promise<Customer[]> {
  return customersData as Customer[];
}
