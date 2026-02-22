"use client";

import { useEffect, useState } from "react";
import { RoutePlanner } from "./route-planner";
import type { Customer } from "@/lib/customers";

export default function HomeClient() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let isMounted = true;

    async function fetchCustomers() {
      try {
        const response = await fetch("/api/customers", { cache: "no-store" });
        if (!response.ok) {
          throw new Error("Failed to load customers.");
        }
        const data = (await response.json()) as { customers: Customer[] };
        if (isMounted) {
          setCustomers(data.customers);
        }
      } catch {
        if (isMounted) {
          setError("Could not load customer data");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void fetchCustomers();

    return () => {
      isMounted = false;
    };
  }, []);

  if (isLoading) {
    return <p style={{ padding: 24 }}>Loading customers...</p>;
  }

  if (error) {
    return <p style={{ padding: 24 }}>{error}</p>;
  }

  return <RoutePlanner customers={customers} />;
}
