"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import type { Customer } from "@/lib/customers";
import styles from "./page.module.css";
import makroLogo from "../makrofood.png";

type RouteStop = {
  stopId: string;
  position: number;
  status: "pending" | "delivered" | "skipped";
  customerId: string;
  customerName: string;
  address: string;
  city: string;
  state: string;
  zip: string;
};

type RoutePlannerProps = {
  customers: Customer[];
};

type Trip = {
  tripId: string;
  status: "draft" | "in_progress" | "completed";
  warehouseAddress: string;
  stops: RouteStop[];
};

type OptimizationSummary = {
  totalKm: number;
  totalSeconds: number;
  totalMiles: number;
  etaHouston: string;
  warnings: string[];
};

function formatDuration(totalSeconds: number): string {
  const minutes = Math.round(totalSeconds / 60);
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours <= 0) {
    return `${mins} min`;
  }
  return `${hours}h ${mins}m`;
}

export function RoutePlanner({ customers }: RoutePlannerProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [warehouseAddress, setWarehouseAddress] = useState(
    "5072 Steadmont Dr, Houston, TX 77040",
  );
  const [endAddress, setEndAddress] = useState(
    "5072 Steadmont Dr, Houston, TX 77040",
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [optimizationSummary, setOptimizationSummary] =
    useState<OptimizationSummary | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [nonGeocodedCustomerIds, setNonGeocodedCustomerIds] = useState<Set<string>>(
    () => new Set(),
  );

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const customerById = useMemo(
    () => new Map(customers.map((customer) => [customer.id, customer])),
    [customers],
  );

  const filteredCustomers = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) {
      return customers;
    }
    const lower = (value: unknown) => String(value ?? "").toLowerCase();
    return customers.filter((customer) => {
      return (
        lower(customer.name).includes(search) ||
        lower(customer.city).includes(search) ||
        lower(customer.state).includes(search) ||
        lower(customer.addressLine1).includes(search) ||
        lower(customer.zip).includes(search)
      );
    });
  }, [query, customers]);

  const customersWithSelectedFirst = useMemo(() => {
    const selected = selectedIds
      .map((id) => customerById.get(id))
      .filter((c): c is Customer => c !== undefined);
    const selectedIdsSet = new Set(selectedIds);
    const rest = filteredCustomers.filter((c) => !selectedIdsSet.has(c.id));
    return [...selected, ...rest];
  }, [filteredCustomers, customerById, selectedIds]);

  const selectedCustomers = useMemo(() => {
    return selectedIds
      .map((id) => customerById.get(id))
      .filter((customer): customer is Customer => customer !== undefined);
  }, [customerById, selectedIds]);

  const toggleCustomer = (customerId: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(customerId)) {
        return prev.filter((id) => id !== customerId);
      }
      return [...prev, customerId];
    });
  };

  const createRoute = async () => {
    setError("");
    setIsCreating(true);

    try {
      const optimizeResponse = await fetch("/api/optimize-route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customers: selectedCustomers,
          warehouseAddress,
          endAddress: endAddress.trim() || warehouseAddress,
        }),
      });
      const optimizePayload = (await optimizeResponse.json()) as {
        error?: string;
        customers?: Customer[];
        totalKm?: number;
        totalSeconds?: number;
        legEtas?: Array<{ etaHouston?: string }>;
        warnings?: string[];
      };
      if (!optimizeResponse.ok) {
        throw new Error(
          optimizePayload.error ?? "Could not optimize selected customers",
        );
      }

      const optimized = optimizePayload as {
        customers: Customer[];
        totalKm?: number;
        totalSeconds?: number;
        legEtas?: Array<{ etaHouston?: string }>;
        warnings?: string[];
      };

      const lastEta =
        optimized.legEtas && optimized.legEtas.length > 0
          ? optimized.legEtas[optimized.legEtas.length - 1]?.etaHouston || "-"
          : "-";
      const totalKm = Number.isFinite(optimized.totalKm) ? Number(optimized.totalKm) : 0;
      const totalSeconds = Number.isFinite(optimized.totalSeconds)
        ? Number(optimized.totalSeconds)
        : 0;
      setOptimizationSummary({
        totalKm,
        totalSeconds,
        totalMiles: totalKm * 0.621371,
        etaHouston: lastEta,
        warnings: Array.isArray(optimized.warnings) ? optimized.warnings : [],
      });

      const optimizedIds = optimized.customers.map((customer) => customer.id);
      const selectedIdsInOrder = selectedCustomers.map((customer) => customer.id);
      const optimizedSet = new Set(optimizedIds);
      const notInOptimized = selectedIdsInOrder.filter((id) => !optimizedSet.has(id));
      const customerIdsForDraft =
        optimizedIds.length > 0
          ? [...optimizedIds, ...notInOptimized]
          : selectedIdsInOrder;
      const usedFallback = optimizedIds.length === 0;
      const droppedCount = notInOptimized.length;
      setNonGeocodedCustomerIds(new Set(notInOptimized));

      const createResponse = await fetch("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerIds: customerIdsForDraft,
          warehouseAddress,
        }),
      });
      if (!createResponse.ok) {
        const payload = (await createResponse.json()) as { error?: string };
        throw new Error(payload.error ?? "Failed to create trip draft");
      }
      const data = (await createResponse.json()) as { trip?: Trip };
      if (!data.trip || !Array.isArray(data.trip.stops)) {
        throw new Error("Invalid trip response");
      }
      setTrip(data.trip);
      if (usedFallback) {
        setError(
          "Optimization confidence was low for all stops. Draft created using selected order for manual review.",
        );
      } else if (droppedCount > 0) {
        setError(
          `${droppedCount} stop(s) could not be geocoded; added at the end in selection order. You can reorder or remove them in Route Review.`,
        );
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not create route. Please try again.";
      setError(message);
      setOptimizationSummary(null);
      setNonGeocodedCustomerIds(new Set());
    } finally {
      setIsCreating(false);
    }
  };

  const moveStop = async (stopId: string, direction: "up" | "down") => {
    if (!trip) {
      return;
    }
    setIsSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/trips/${trip.tripId}/reorder`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stopId, direction }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Failed to reorder stop");
      }
      const data = (await response.json()) as { trip?: Trip };
      if (!data.trip || !Array.isArray(data.trip.stops)) {
        throw new Error("Invalid trip response");
      }
      setTrip(data.trip);
      void recalculateSummary(data.trip);
    } catch {
      setError("Could not reorder this stop.");
    } finally {
      setIsSaving(false);
    }
  };

  const removeStop = async (stopId: string) => {
    if (!trip) {
      return;
    }
    setIsSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/trips/${trip.tripId}/stops/${stopId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Failed to remove stop");
      }
      const data = (await response.json()) as { trip?: Trip };
      if (!data.trip || !Array.isArray(data.trip.stops)) {
        throw new Error("Invalid trip response");
      }
      setTrip(data.trip);
      void recalculateSummary(data.trip);
    } catch {
      setError("Could not remove this stop.");
    } finally {
      setIsSaving(false);
    }
  };

  const recalculateSummary = async (nextTrip: Trip) => {
    const orderedCustomers: Customer[] = nextTrip.stops.map((stop) => {
      const source = customerById.get(stop.customerId);
      return {
        id: stop.customerId,
        name: stop.customerName,
        addressLine1: stop.address,
        city: stop.city,
        state: stop.state,
        zip: stop.zip,
        country: source?.country ?? "US",
      };
    });

    try {
      const response = await fetch("/api/route-distance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customers: orderedCustomers,
          warehouseAddress,
          endAddress: endAddress.trim() || warehouseAddress,
        }),
      });
      if (!response.ok) {
        return;
      }
      const payload = (await response.json()) as {
        totalKm?: number;
        totalSeconds?: number;
        unresolvedStops?: number;
      };
      const totalKm = Number.isFinite(payload.totalKm) ? Number(payload.totalKm) : 0;
      const totalSeconds = Number.isFinite(payload.totalSeconds) ? Number(payload.totalSeconds) : 0;
      const unresolvedStops = Number.isFinite(payload.unresolvedStops)
        ? Number(payload.unresolvedStops)
        : 0;
      setOptimizationSummary((prev) => ({
        totalKm,
        totalSeconds,
        totalMiles: totalKm * 0.621371,
        etaHouston: prev?.etaHouston ?? "-",
        warnings:
          unresolvedStops > 0
            ? [`${unresolvedStops} stop(s) could not be geocoded for mileage/time estimate.`]
            : (prev?.warnings ?? []),
      }));
    } catch {
      // Keep previous summary if recalculation fails.
    }
  };

  const startTrip = async () => {
    if (!trip) {
      return;
    }
    setIsSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/trips/${trip.tripId}/start`, {
        method: "PATCH",
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Failed to start trip");
      }
      router.push(`/trips/${trip.tripId}`);
    } catch {
      setError("Could not start the trip.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <div className={styles.headerBrand}>
            <Image
              src={makroLogo}
              alt="Makro Food logo"
              width={56}
              height={56}
              className={styles.headerLogo}
              priority
            />
            <div>
              <h1>Makro Route MVP</h1>
              <p>Loaded {customers.length} customers from Customers.xlsx.</p>
            </div>
          </div>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.btnMuted}
              onClick={() => router.push("/history")}
            >
              History
            </button>
            <div className={styles.counter}>Selected ({selectedIds.length})</div>
          </div>
        </header>

        <section className={styles.grid}>
          <article className={styles.card}>
            <h2>1) Customer Picker</h2>
            <div className={styles.inlineControls}>
              <label className={styles.fieldLabel} htmlFor="warehouse-address">
                Start (warehouse) address
              </label>
              <input
                id="warehouse-address"
                className={styles.search}
                type="text"
                value={warehouseAddress}
                onChange={(event) => setWarehouseAddress(event.target.value)}
                placeholder="e.g. 5072 Steadmont Dr, Houston, TX 77040"
              />
            </div>
            <div className={styles.inlineControls}>
              <label className={styles.fieldLabel} htmlFor="end-address">
                End (return) address
              </label>
              <input
                id="end-address"
                className={styles.search}
                type="text"
                value={endAddress}
                onChange={(event) => setEndAddress(event.target.value)}
                placeholder="Same as start by default"
              />
            </div>
            <input
              className={styles.search}
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Type company, city, state, or zip"
            />
            <div className={styles.list}>
              {customersWithSelectedFirst.map((customer) => {
                const selected = selectedSet.has(customer.id);
                return (
                  <div className={styles.row} key={customer.id}>
                    <div>
                      <strong>{customer.name}</strong>
                      <p>
                        {customer.addressLine1}, {customer.city}, {customer.state}{" "}
                        {customer.zip}
                      </p>
                    </div>
                    <button
                      className={selected ? styles.btnMuted : styles.btnPrimary}
                      onClick={() => toggleCustomer(customer.id)}
                      type="button"
                    >
                      {selected ? "Remove" : "Add"}
                    </button>
                  </div>
                );
              })}
            </div>
            <button
              className={styles.btnCreate}
              type="button"
              onClick={() => {
                void createRoute();
              }}
              disabled={selectedCustomers.length === 0 || isCreating}
            >
              {isCreating
                ? "Creating draft..."
                : `Create Route (${selectedCustomers.length})`}
            </button>
            {error ? <p className={styles.errorText}>{error}</p> : null}
          </article>

          <article className={styles.card}>
            <div className={styles.sectionTitle}>
              <h2>2) Route Review</h2>
              {trip ? <span className={styles.meta}>Trip ID: {trip.tripId}</span> : null}
            </div>
            {optimizationSummary ? (
              <div className={styles.stats}>
                <p>
                  Mileage: <strong>{optimizationSummary.totalMiles.toFixed(1)} mi</strong>
                </p>
                <p>
                  Total travel:{" "}
                  <strong>{formatDuration(optimizationSummary.totalSeconds)}</strong>
                </p>
                <p>
                  ETA (Houston): <strong>{optimizationSummary.etaHouston}</strong>
                </p>
                {optimizationSummary.warnings.length > 0 ? (
                  <p className={styles.statsNote}>
                    Warning: {optimizationSummary.warnings[0]}
                  </p>
                ) : null}
              </div>
            ) : null}
            {!trip ? (
              <p className={styles.empty}>Create route draft after selecting customers.</p>
            ) : (
              <div className={styles.list}>
                {trip.stops.map((stop, index) => (
                  <div
                    className={`${styles.stopCard} ${nonGeocodedCustomerIds.has(stop.customerId) ? styles.stopCardNoGeocode : ""}`.trim()}
                    key={stop.stopId}
                  >
                    <div className={styles.stopHeader}>
                      <span className={styles.stopNumber}>#{stop.position}</span>
                      <span className={styles.badge} data-status={stop.status}>
                        {stop.status}
                      </span>
                    </div>
                    <strong>{stop.customerName}</strong>
                    <p>
                      {stop.address}
                    </p>
                    <div className={styles.actions}>
                      <button
                        type="button"
                        className={styles.btnMuted}
                        onClick={() => {
                          void moveStop(stop.stopId, "up");
                        }}
                        disabled={index === 0}
                      >
                        Move up
                      </button>
                      <button
                        type="button"
                        className={styles.btnMuted}
                        onClick={() => {
                          void moveStop(stop.stopId, "down");
                        }}
                        disabled={index === trip.stops.length - 1}
                      >
                        Move down
                      </button>
                      <button
                        type="button"
                        className={styles.btnWarn}
                        onClick={() => {
                          void removeStop(stop.stopId);
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <button
              className={styles.btnCreate}
              type="button"
              disabled={!trip || trip.stops.length === 0 || isSaving}
              onClick={() => {
                void startTrip();
              }}
            >
              {isSaving ? "Saving..." : "Go to Trip"}
            </button>
          </article>
        </section>
      </main>
    </div>
  );
}
