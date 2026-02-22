"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import type { Customer } from "@/lib/customers";
import styles from "./page.module.css";
import makroLogo from "../makrofood.png";

type StopStatus = "pending" | "delivered" | "skipped";

type RouteStop = {
  id: string;
  customer: Customer;
  position: number;
  status: StopStatus;
};

type RoutePlannerProps = {
  customers: Customer[];
};

function renumberStops(stops: RouteStop[]): RouteStop[] {
  return stops.map((stop, index) => ({ ...stop, position: index + 1 }));
}

function mapsLink(stop: RouteStop): string {
  const address = [
    stop.customer.addressLine1,
    stop.customer.city,
    stop.customer.state,
    stop.customer.country,
    stop.customer.zip,
  ]
    .filter(Boolean)
    .join(", ");

  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

function buildRoute(selectedCustomers: Customer[]): RouteStop[] {
  return selectedCustomers.map((customer, index) => ({
    id: `stop-${customer.id}`,
    customer,
    position: index + 1,
    status: "pending",
  }));
}

async function fetchRouteDistanceKm(
  customersForDistance: Customer[],
  warehouseAddress: string,
): Promise<{ totalKm: number; unresolvedStops: number }> {
  const response = await fetch("/api/route-distance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customers: customersForDistance,
      warehouseAddress,
    }),
  });

  if (!response.ok) {
    throw new Error("Distance request failed");
  }

  return (await response.json()) as { totalKm: number; unresolvedStops: number };
}

export function RoutePlanner({ customers }: RoutePlannerProps) {
  const [query, setQuery] = useState("");
  const [warehouseAddress, setWarehouseAddress] = useState(
    "5072 Steadmont Dr, Houston, TX 77040",
  );
  const [startLatitude, setStartLatitude] = useState<number | null>(null);
  const [startLongitude, setStartLongitude] = useState<number | null>(null);
  const [startSource, setStartSource] = useState<"address" | "location">("address");
  const [locationStatus, setLocationStatus] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [routeStops, setRouteStops] = useState<RouteStop[]>([]);
  const [currentStop, setCurrentStop] = useState(0);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimizeError, setOptimizeError] = useState("");
  const [optimizedDistanceKm, setOptimizedDistanceKm] = useState<number | null>(null);
  const [currentDistanceKm, setCurrentDistanceKm] = useState<number | null>(null);
  const [unresolvedStops, setUnresolvedStops] = useState(0);

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
    return customers.filter((customer) => {
      return (
        customer.name.toLowerCase().includes(search) ||
        customer.city.toLowerCase().includes(search) ||
        customer.state.toLowerCase().includes(search) ||
        customer.addressLine1.toLowerCase().includes(search) ||
        customer.zip.toLowerCase().includes(search)
      );
    });
  }, [query, customers]);

  const selectedCustomers = useMemo(() => {
    return selectedIds
      .map((id) => customerById.get(id))
      .filter((customer): customer is Customer => customer !== undefined);
  }, [customerById, selectedIds]);

  const activeStop = routeStops[currentStop];
  const optimizedMiles =
    optimizedDistanceKm === null ? null : optimizedDistanceKm * 0.621371;
  const currentMiles = currentDistanceKm === null ? null : currentDistanceKm * 0.621371;
  const deltaMiles =
    optimizedMiles === null || currentMiles === null
      ? null
      : currentMiles - optimizedMiles;

  useEffect(() => {
    async function calculateDistance() {
      if (routeStops.length === 0) {
        setCurrentDistanceKm(null);
        setUnresolvedStops(0);
        return;
      }

      try {
        const data = await fetchRouteDistanceKm(
          routeStops.map((stop) => stop.customer),
          warehouseAddress,
        );
        setCurrentDistanceKm(data.totalKm);
        setUnresolvedStops(data.unresolvedStops);
      } catch {
        setCurrentDistanceKm(null);
      }
    }

    void calculateDistance();
  }, [routeStops, warehouseAddress, startLatitude, startLongitude, startSource]);

  const requestLocationStart = () => {
    if (!navigator.geolocation) {
      setLocationStatus("Geolocation is not supported in this browser.");
      return;
    }

    setLocationStatus("Requesting location permission...");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setStartLatitude(position.coords.latitude);
        setStartLongitude(position.coords.longitude);
        setStartSource("location");
        setLocationStatus("Using your current location as route start.");
      },
      () => {
        setLocationStatus("Location permission denied. Using warehouse address.");
        setStartSource("address");
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const useWarehouseAddressStart = () => {
    setStartSource("address");
    setLocationStatus("Using warehouse address as route start.");
  };

  const toggleCustomer = (customerId: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(customerId)) {
        return prev.filter((id) => id !== customerId);
      }
      return [...prev, customerId];
    });
  };

  const createRoute = async () => {
    setOptimizeError("");
    setIsOptimizing(true);

    try {
      const response = await fetch("/api/optimize-route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customers: selectedCustomers,
          warehouseAddress,
          startLatitude: startSource === "location" ? startLatitude : undefined,
          startLongitude: startSource === "location" ? startLongitude : undefined,
        }),
      });

      if (!response.ok) {
        throw new Error("Could not optimize route");
      }

      const data = (await response.json()) as {
        customers: Customer[];
        totalKm: number;
        unresolvedStops: number;
      };
      const optimizedStops = buildRoute(data.customers);
      setRouteStops(optimizedStops);
      setCurrentStop(0);

      // Keep baseline and current mileage on the exact same calculation path.
      const distance = await fetchRouteDistanceKm(data.customers, warehouseAddress);
      setOptimizedDistanceKm(distance.totalKm);
      setCurrentDistanceKm(distance.totalKm);
      setUnresolvedStops(distance.unresolvedStops);
    } catch {
      // Fallback keeps routing usable even if optimization endpoint fails.
      setOptimizeError("Optimization failed. Using selected order.");
      setRouteStops(buildRoute(selectedCustomers));
      setCurrentStop(0);
      setOptimizedDistanceKm(null);
      setCurrentDistanceKm(null);
    } finally {
      setIsOptimizing(false);
    }
  };

  const moveStop = (index: number, direction: "up" | "down") => {
    setRouteStops((prev) => {
      const target = direction === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= prev.length) {
        return prev;
      }
      const next = [...prev];
      const temp = next[index];
      next[index] = next[target];
      next[target] = temp;
      return renumberStops(next);
    });
  };

  const updateStopStatus = (stopId: string, status: StopStatus) => {
    setRouteStops((prev) =>
      prev.map((stop) => (stop.id === stopId ? { ...stop, status } : stop)),
    );
  };

  const clearRoute = () => {
    setRouteStops([]);
    setCurrentStop(0);
    setOptimizedDistanceKm(null);
    setCurrentDistanceKm(null);
    setUnresolvedStops(0);
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
          <div className={styles.counter}>Selected ({selectedIds.length})</div>
        </header>

        <section className={styles.grid}>
          <article className={styles.card}>
            <h2>1) Customer Picker</h2>
            <div className={styles.inlineControls}>
              <label className={styles.fieldLabel} htmlFor="warehouse-address">
                Warehouse address
              </label>
              <input
                id="warehouse-address"
                className={styles.search}
                type="text"
                value={warehouseAddress}
                onChange={(event) => setWarehouseAddress(event.target.value)}
                placeholder="e.g. 5072 Steadmont Dr, Houston, TX 77040"
              />
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.btnMuted}
                  onClick={requestLocationStart}
                >
                  Use my current location
                </button>
                <button
                  type="button"
                  className={styles.btnMuted}
                  onClick={useWarehouseAddressStart}
                >
                  Use warehouse address
                </button>
              </div>
              <p className={styles.meta}>
                Start point:{" "}
                {startSource === "location" ? "Current location" : "Warehouse address"}
              </p>
              {locationStatus ? <p className={styles.meta}>{locationStatus}</p> : null}
            </div>
            <input
              className={styles.search}
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Type company, city, state, or zip"
            />
            <div className={styles.list}>
              {filteredCustomers.map((customer) => {
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
              disabled={selectedCustomers.length === 0 || isOptimizing}
            >
              {isOptimizing
                ? "Optimizing..."
                : `Create Route (${selectedCustomers.length})`}
            </button>
            {optimizeError ? <p className={styles.errorText}>{optimizeError}</p> : null}
          </article>

          <article className={styles.card}>
            <div className={styles.sectionTitle}>
              <h2>2) Route (Admin)</h2>
              {routeStops.length > 0 ? (
                <button className={styles.btnText} type="button" onClick={clearRoute}>
                  Clear Route
                </button>
              ) : null}
            </div>
            {routeStops.length > 0 ? (
              <div className={styles.stats}>
                <p>
                  Optimized (from warehouse):{" "}
                  <strong>
                    {optimizedMiles === null ? "-" : `${optimizedMiles.toFixed(1)} mi`}
                  </strong>
                </p>
                <p>
                  Current (from warehouse):{" "}
                  <strong>
                    {currentMiles === null ? "-" : `${currentMiles.toFixed(1)} mi`}
                  </strong>
                </p>
                <p>
                  Delta:{" "}
                  <strong
                    className={
                      deltaMiles !== null && deltaMiles > 0
                        ? styles.deltaWorse
                        : styles.deltaBetter
                    }
                  >
                    {deltaMiles === null
                      ? "-"
                      : `${deltaMiles > 0 ? "+" : ""}${deltaMiles.toFixed(1)} mi`}
                  </strong>
                </p>
                {unresolvedStops > 0 ? (
                  <p className={styles.statsNote}>
                    {unresolvedStops} stop(s) missing valid ZIP and excluded from estimate.
                  </p>
                ) : null}
              </div>
            ) : null}
            {routeStops.length === 0 ? (
              <p className={styles.empty}>Create route after selecting customers.</p>
            ) : (
              <div className={styles.list}>
                {routeStops.map((stop, index) => (
                  <div className={styles.stopCard} key={stop.id}>
                    <div className={styles.stopHeader}>
                      <span className={styles.stopNumber}>#{stop.position}</span>
                      <span className={styles.badge} data-status={stop.status}>
                        {stop.status}
                      </span>
                    </div>
                    <strong>{stop.customer.name}</strong>
                    <p>
                      {stop.customer.addressLine1}, {stop.customer.city}
                    </p>
                    <div className={styles.actions}>
                      <button
                        type="button"
                        className={styles.btnMuted}
                        onClick={() => moveStop(index, "up")}
                        disabled={index === 0}
                      >
                        Move up
                      </button>
                      <button
                        type="button"
                        className={styles.btnMuted}
                        onClick={() => moveStop(index, "down")}
                        disabled={index === routeStops.length - 1}
                      >
                        Move down
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </article>

          <article className={styles.card}>
            <h2>3) Driver View</h2>
            {activeStop ? (
              <>
                <div className={styles.driverCard}>
                  <p className={styles.bigNumber}>#{activeStop.position}</p>
                  <strong>{activeStop.customer.name}</strong>
                  <p>
                    {activeStop.customer.addressLine1}, {activeStop.customer.city}
                  </p>
                  <div className={styles.actions}>
                    <a
                      className={styles.btnPrimary}
                      href={mapsLink(activeStop)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Navigate
                    </a>
                    <button
                      className={styles.btnSuccess}
                      type="button"
                      onClick={() => updateStopStatus(activeStop.id, "delivered")}
                    >
                      Delivered
                    </button>
                    <button
                      className={styles.btnWarn}
                      type="button"
                      onClick={() => updateStopStatus(activeStop.id, "skipped")}
                    >
                      Skipped
                    </button>
                  </div>
                  <div className={styles.actions}>
                    <button
                      className={styles.btnMuted}
                      type="button"
                      onClick={() => setCurrentStop((prev) => Math.max(prev - 1, 0))}
                      disabled={currentStop === 0}
                    >
                      Previous
                    </button>
                    <button
                      className={styles.btnMuted}
                      type="button"
                      onClick={() =>
                        setCurrentStop((prev) => Math.min(prev + 1, routeStops.length - 1))
                      }
                      disabled={currentStop >= routeStops.length - 1}
                    >
                      Next
                    </button>
                  </div>
                </div>

                <div className={styles.driverListHeader}>All addresses</div>
                <div className={styles.list}>
                  {routeStops.map((stop, index) => (
                    <div
                      key={`driver-${stop.id}`}
                      className={`${styles.stopCard} ${
                        index === currentStop ? styles.activeStopCard : ""
                      }`}
                    >
                      <div className={styles.stopHeader}>
                        <span className={styles.stopNumber}>#{stop.position}</span>
                        <span className={styles.badge} data-status={stop.status}>
                          {stop.status}
                        </span>
                      </div>
                      <strong>{stop.customer.name}</strong>
                      <p>
                        {stop.customer.addressLine1}, {stop.customer.city}
                      </p>
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
                          className={styles.btnMuted}
                          type="button"
                          onClick={() => setCurrentStop(index)}
                        >
                          Open stop
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className={styles.empty}>Driver view appears after route creation.</p>
            )}
          </article>
        </section>
      </main>
    </div>
  );
}
