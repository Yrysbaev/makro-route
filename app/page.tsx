"use client";

import { useMemo, useState } from "react";
import styles from "./page.module.css";

type StopStatus = "pending" | "delivered" | "skipped";

type Customer = {
  id: string;
  name: string;
  addressLine1: string;
  city: string;
  phone: string;
  latitude: number;
  longitude: number;
};

type RouteStop = {
  id: string;
  customer: Customer;
  position: number;
  status: StopStatus;
};

const WAREHOUSE = {
  name: "Main Warehouse",
  address: "12 Logistics Ave, Almaty",
  latitude: 43.238,
  longitude: 76.889,
};

const CUSTOMER_DATA: Customer[] = [
  { id: "c1", name: "Alem Mart", addressLine1: "45 Abay Ave", city: "Almaty", phone: "+7 701 100 1001", latitude: 43.244, longitude: 76.92 },
  { id: "c2", name: "Green Basket", addressLine1: "19 Tulebaev St", city: "Almaty", phone: "+7 701 100 1002", latitude: 43.258, longitude: 76.944 },
  { id: "c3", name: "Dostar Foods", addressLine1: "102 Satpaev St", city: "Almaty", phone: "+7 701 100 1003", latitude: 43.228, longitude: 76.901 },
  { id: "c4", name: "Silk Road Shop", addressLine1: "8 Raiymbek Ave", city: "Almaty", phone: "+7 701 100 1004", latitude: 43.274, longitude: 76.875 },
  { id: "c5", name: "Mega Trade", addressLine1: "55 Rozybakiev St", city: "Almaty", phone: "+7 701 100 1005", latitude: 43.207, longitude: 76.896 },
  { id: "c6", name: "Fruit Planet", addressLine1: "120 Seifullin Ave", city: "Almaty", phone: "+7 701 100 1006", latitude: 43.242, longitude: 76.864 },
  { id: "c7", name: "Central Grocery", addressLine1: "67 Nazarbayev Ave", city: "Almaty", phone: "+7 701 100 1007", latitude: 43.253, longitude: 76.918 },
  { id: "c8", name: "Box Market", addressLine1: "31 Bogenbay Batyr St", city: "Almaty", phone: "+7 701 100 1008", latitude: 43.249, longitude: 76.952 },
  { id: "c9", name: "Vostok Mini", addressLine1: "14 Zheltoksan St", city: "Almaty", phone: "+7 701 100 1009", latitude: 43.261, longitude: 76.905 },
  { id: "c10", name: "Family Store", addressLine1: "88 Tole Bi St", city: "Almaty", phone: "+7 701 100 1010", latitude: 43.232, longitude: 76.936 },
  { id: "c11", name: "Fresh Land", addressLine1: "4 Auezov St", city: "Almaty", phone: "+7 701 100 1011", latitude: 43.213, longitude: 76.942 },
  { id: "c12", name: "7 Days Shop", addressLine1: "26 Sain St", city: "Almaty", phone: "+7 701 100 1012", latitude: 43.225, longitude: 76.855 },
  { id: "c13", name: "Arman Market", addressLine1: "71 Baizakov St", city: "Almaty", phone: "+7 701 100 1013", latitude: 43.219, longitude: 76.913 },
  { id: "c14", name: "City Food Hub", addressLine1: "93 Furmanov St", city: "Almaty", phone: "+7 701 100 1014", latitude: 43.268, longitude: 76.927 },
  { id: "c15", name: "Karavan Store", addressLine1: "17 Suyunbay Ave", city: "Almaty", phone: "+7 701 100 1015", latitude: 43.283, longitude: 76.913 },
  { id: "c16", name: "North Point Shop", addressLine1: "112 Ryskulov Ave", city: "Almaty", phone: "+7 701 100 1016", latitude: 43.286, longitude: 76.853 },
  { id: "c17", name: "Millennium Retail", addressLine1: "37 Zhandosov St", city: "Almaty", phone: "+7 701 100 1017", latitude: 43.217, longitude: 76.878 },
  { id: "c18", name: "Olzha Cash", addressLine1: "61 Momyshuly St", city: "Almaty", phone: "+7 701 100 1018", latitude: 43.196, longitude: 76.841 },
  { id: "c19", name: "Caspian Foods", addressLine1: "28 Saken Seifullin St", city: "Almaty", phone: "+7 701 100 1019", latitude: 43.245, longitude: 76.887 },
  { id: "c20", name: "Rahat Point", addressLine1: "50 Timiryazev St", city: "Almaty", phone: "+7 701 100 1020", latitude: 43.223, longitude: 76.949 },
];

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(a));
}

function optimizeStops(customers: Customer[]): RouteStop[] {
  const remaining = [...customers];
  const ordered: Customer[] = [];
  let currentLat = WAREHOUSE.latitude;
  let currentLon = WAREHOUSE.longitude;

  while (remaining.length > 0) {
    let closestIdx = 0;
    let closestDistance = Number.POSITIVE_INFINITY;

    for (let i = 0; i < remaining.length; i += 1) {
      const candidate = remaining[i];
      const distance = haversineKm(
        currentLat,
        currentLon,
        candidate.latitude,
        candidate.longitude,
      );
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIdx = i;
      }
    }

    const [nextStop] = remaining.splice(closestIdx, 1);
    ordered.push(nextStop);
    currentLat = nextStop.latitude;
    currentLon = nextStop.longitude;
  }

  return ordered.map((customer, index) => ({
    id: `stop-${customer.id}`,
    customer,
    position: index + 1,
    status: "pending",
  }));
}

function renumberStops(stops: RouteStop[]): RouteStop[] {
  return stops.map((stop, index) => ({ ...stop, position: index + 1 }));
}

function mapsLink(stop: RouteStop): string {
  return `https://www.google.com/maps/search/?api=1&query=${stop.customer.latitude},${stop.customer.longitude}`;
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [routeStops, setRouteStops] = useState<RouteStop[]>([]);
  const [currentStop, setCurrentStop] = useState(0);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const filteredCustomers = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) {
      return CUSTOMER_DATA;
    }
    return CUSTOMER_DATA.filter((customer) => {
      return (
        customer.name.toLowerCase().includes(search) ||
        customer.city.toLowerCase().includes(search) ||
        customer.addressLine1.toLowerCase().includes(search)
      );
    });
  }, [query]);

  const selectedCustomers = useMemo(() => {
    return CUSTOMER_DATA.filter((customer) => selectedSet.has(customer.id));
  }, [selectedSet]);

  const pendingIndexes = useMemo(() => {
    return routeStops
      .map((stop, index) => ({ stop, index }))
      .filter(({ stop }) => stop.status === "pending")
      .map(({ index }) => index);
  }, [routeStops]);

  const activeStop = routeStops[currentStop];

  const toggleCustomer = (customerId: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(customerId)) {
        return prev.filter((id) => id !== customerId);
      }
      return [...prev, customerId];
    });
  };

  const createRoute = () => {
    const optimized = optimizeStops(selectedCustomers);
    setRouteStops(optimized);
    setCurrentStop(0);
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

    if (status !== "pending") {
      const nextPendingIndex = pendingIndexes.find((index) => index > currentStop);
      if (nextPendingIndex !== undefined) {
        setCurrentStop(nextPendingIndex);
      }
    }
  };

  const clearRoute = () => {
    setRouteStops([]);
    setCurrentStop(0);
  };

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <div>
            <h1>Makro Route MVP</h1>
            <p>Plan 15-20 wholesale deliveries in minutes.</p>
          </div>
          <div className={styles.counter}>Selected ({selectedIds.length})</div>
        </header>

        <section className={styles.grid}>
          <article className={styles.card}>
            <h2>1) Customer Picker</h2>
            <input
              className={styles.search}
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Type store name or city"
            />
            <p className={styles.meta}>Warehouse: {WAREHOUSE.address}</p>
            <div className={styles.list}>
              {filteredCustomers.map((customer) => {
                const selected = selectedSet.has(customer.id);
                return (
                  <div className={styles.row} key={customer.id}>
                    <div>
                      <strong>{customer.name}</strong>
                      <p>
                        {customer.addressLine1}, {customer.city}
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
              onClick={createRoute}
              disabled={selectedCustomers.length === 0}
            >
              Create Route ({selectedCustomers.length})
            </button>
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
            ) : (
              <p className={styles.empty}>Driver view appears after route creation.</p>
            )}
          </article>
        </section>
      </main>
    </div>
  );
}
