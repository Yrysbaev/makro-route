"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../../page.module.css";

type TripStop = {
  stopId: string;
  position: number;
  status: "pending" | "delivered" | "skipped";
  customerName: string;
  address: string;
  skippedReason: string;
};

type Trip = {
  tripId: string;
  status: "draft" | "in_progress" | "completed";
  stops: TripStop[];
};

type TripClientProps = {
  tripId: string;
};

function mapsLink(stop: TripStop): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    stop.address,
  )}`;
}

export default function TripClient({ tripId }: TripClientProps) {
  const router = useRouter();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  const pendingCount = useMemo(
    () => trip?.stops.filter((stop) => stop.status === "pending").length ?? 0,
    [trip],
  );

  const loadTrip = useCallback(async () => {
    setError("");
    setIsLoading(true);
    try {
      const response = await fetch(`/api/trips/${tripId}`, { cache: "no-store" });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Failed to load trip");
      }
      const data = (await response.json()) as { trip?: Trip };
      if (!data.trip || !Array.isArray(data.trip.stops)) {
        throw new Error("Invalid trip payload");
      }
      setTrip(data.trip);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Failed to load trip";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [tripId]);

  useEffect(() => {
    void loadTrip();
  }, [loadTrip]);

  const updateStatus = async (
    stopId: string,
    status: "pending" | "delivered" | "skipped",
  ) => {
    setIsSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/trips/${tripId}/stops/${stopId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Failed to update stop");
      }
      const data = (await response.json()) as { trip?: Trip };
      if (!data.trip || !Array.isArray(data.trip.stops)) {
        throw new Error("Invalid trip payload");
      }
      setTrip(data.trip);
    } catch {
      setError("Could not update stop status.");
    } finally {
      setIsSaving(false);
    }
  };

  const submitTrip = async () => {
    setIsSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/trips/${tripId}/submit`, {
        method: "PATCH",
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Failed to submit trip");
      }
      router.push(`/trips/${tripId}/summary`);
    } catch {
      setError("Could not submit trip.");
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <p style={{ padding: 24 }}>Loading trip...</p>;
  }

  if (!trip) {
    return <p style={{ padding: 24 }}>Trip not found.</p>;
  }

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <div>
            <h1>Trip In Progress</h1>
            <p>
              Trip ID: {trip.tripId} | Pending: {pendingCount}
            </p>
          </div>
          <button
            type="button"
            className={styles.btnMuted}
            onClick={() => router.push("/")}
          >
            Back to Planner
          </button>
        </header>

        {error ? <p className={styles.errorText}>{error}</p> : null}

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
                <div className={styles.actions}>
                  <a
                    className={styles.btnPrimary}
                    href={mapsLink(stop)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Navigate
                  </a>
                  <button
                    type="button"
                    className={styles.btnSuccess}
                    onClick={() => {
                      void updateStatus(stop.stopId, "delivered");
                    }}
                    disabled={isSaving}
                  >
                    Delivered
                  </button>
                  <button
                    type="button"
                    className={styles.btnWarn}
                    onClick={() => {
                      void updateStatus(stop.stopId, "skipped");
                    }}
                    disabled={isSaving}
                  >
                    Skipped
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.card}>
          <h2>Submit Trip</h2>
          <p className={styles.meta}>
            You can submit only when all stops are Delivered or Skipped.
          </p>
          <button
            type="button"
            className={styles.btnCreate}
            disabled={pendingCount > 0 || isSaving}
            onClick={() => {
              void submitTrip();
            }}
          >
            {isSaving ? "Submitting..." : "Submit Trip"}
          </button>
        </section>
      </main>
    </div>
  );
}
