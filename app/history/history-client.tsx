"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "../page.module.css";

type HistoryRow = {
  historyId: string;
  tripId: string;
  tripDate: string;
  customerName: string;
  status: "pending" | "delivered" | "skipped";
  deliveredAt: string;
  skippedReason: string;
  driver: string;
};

export default function HistoryClient() {
  const [date, setDate] = useState("");
  const [customer, setCustomer] = useState("");
  const [driver, setDriver] = useState("");
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [error, setError] = useState("");

  const loadRows = useCallback(async () => {
    setError("");
    try {
      const params = new URLSearchParams();
      if (date) params.set("date", date);
      if (customer) params.set("customer", customer);
      if (driver) params.set("driver", driver);
      const response = await fetch(`/api/history?${params.toString()}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error("Failed to load history");
      }
      const data = (await response.json()) as { rows?: HistoryRow[] };
      setRows(Array.isArray(data.rows) ? data.rows : []);
    } catch {
      setError("Could not load history.");
    }
  }, [customer, date, driver]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <div>
            <h1>Delivery History</h1>
            <p>Filter by day, customer, or driver.</p>
          </div>
        </header>

        <section className={styles.card}>
          <h2>Filters</h2>
          <div className={styles.actions}>
            <input
              className={styles.search}
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
            <input
              className={styles.search}
              placeholder="Customer name"
              value={customer}
              onChange={(event) => setCustomer(event.target.value)}
            />
            <input
              className={styles.search}
              placeholder="Driver"
              value={driver}
              onChange={(event) => setDriver(event.target.value)}
            />
            <button
              type="button"
              className={styles.btnPrimary}
              onClick={() => {
                void loadRows();
              }}
            >
              Apply
            </button>
          </div>
        </section>

        {error ? <p className={styles.errorText}>{error}</p> : null}

        <section className={styles.card}>
          <h2>Rows ({rows.length})</h2>
          <div className={styles.list}>
            {rows.map((row) => (
              <div key={row.historyId} className={styles.stopCard}>
                <div className={styles.stopHeader}>
                  <span className={styles.stopNumber}>{row.tripDate}</span>
                  <span className={styles.badge} data-status={row.status}>
                    {row.status}
                  </span>
                </div>
                <strong>{row.customerName}</strong>
                <p>Driver: {row.driver || "-"}</p>
                <p>Trip ID: {row.tripId}</p>
                {row.skippedReason ? <p>Reason: {row.skippedReason}</p> : null}
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
