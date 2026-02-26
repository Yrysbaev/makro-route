"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../../../page.module.css";

type TripStop = {
  stopId: string;
  position: number;
  status: "pending" | "delivered" | "skipped";
  customerName: string;
  address: string;
};

type Trip = {
  tripId: string;
  status: "draft" | "in_progress" | "completed";
  tripDate: string;
  submittedAt: string;
  stops: TripStop[];
};

type Props = {
  tripId: string;
};

export default function TripSummaryClient({ tripId }: Props) {
  const router = useRouter();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadTrip() {
      try {
        const response = await fetch(`/api/trips/${tripId}`, { cache: "no-store" });
        if (!response.ok) {
          throw new Error("Failed to load summary");
        }
        const data = (await response.json()) as { trip?: Trip };
        if (!data.trip || !Array.isArray(data.trip.stops)) {
          throw new Error("Invalid summary payload");
        }
        setTrip(data.trip);
      } catch {
        setError("Could not load trip summary.");
      }
    }
    void loadTrip();
  }, [tripId]);

  const delivered = useMemo(
    () => trip?.stops.filter((stop) => stop.status === "delivered").length ?? 0,
    [trip],
  );
  const skipped = useMemo(
    () => trip?.stops.filter((stop) => stop.status === "skipped").length ?? 0,
    [trip],
  );

  if (error) {
    return <p style={{ padding: 24 }}>{error}</p>;
  }
  if (!trip) {
    return <p style={{ padding: 24 }}>Loading summary...</p>;
  }

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <div>
            <h1>Trip Completed</h1>
            <p>
              Date: {trip.tripDate} | Submitted: {trip.submittedAt || "-"}
            </p>
          </div>
          <button className={styles.btnMuted} onClick={() => router.push("/")}>
            Back to Planner
          </button>
        </header>

        <section className={styles.card}>
          <h2>Summary</h2>
          <div className={styles.stats}>
            <p>
              Total stops: <strong>{trip.stops.length}</strong>
            </p>
            <p>
              Delivered: <strong>{delivered}</strong>
            </p>
            <p>
              Skipped: <strong>{skipped}</strong>
            </p>
          </div>
        </section>

        <section className={styles.card}>
          <h2>Stops</h2>
          <div className={styles.list}>
            {trip.stops.map((stop) => (
              <div key={stop.stopId} className={styles.stopCard}>
                <div className={styles.stopHeader}>
                  <span className={styles.stopNumber}>#{stop.position}</span>
                  <span className={styles.badge} data-status={stop.status}>
                    {stop.status}
                  </span>
                </div>
                <strong>{stop.customerName}</strong>
                <p>{stop.address}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
