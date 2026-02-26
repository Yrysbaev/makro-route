import { randomUUID } from "crypto";
import type { Customer } from "./customers";
import { loadCustomers } from "./customers";
import {
  getTabName,
  readSheetRows,
  replaceSheetRows,
} from "./google-sheets";

export type TripStatus = "draft" | "in_progress" | "completed";
export type StopStatus = "pending" | "delivered" | "skipped";

export type TripStop = {
  tripId: string;
  stopId: string;
  position: number;
  customerId: string;
  customerName: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  status: StopStatus;
  deliveredAt: string;
  skippedReason: string;
  updatedBy: string;
  updatedAt: string;
};

export type Trip = {
  tripId: string;
  tripDate: string;
  createdBy: string;
  startedAt: string;
  submittedAt: string;
  status: TripStatus;
  warehouseAddress: string;
  warehouseLat: string;
  warehouseLng: string;
  stops: TripStop[];
};

type DeliveryHistoryRow = {
  historyId: string;
  tripId: string;
  tripDate: string;
  customerId: string;
  customerName: string;
  status: StopStatus;
  deliveredAt: string;
  skippedReason: string;
  driver: string;
  submittedAt: string;
};

const TRIPS_HEADER = [
  "trip_id",
  "trip_date",
  "created_by",
  "started_at",
  "submitted_at",
  "status",
  "warehouse_address",
  "warehouse_lat",
  "warehouse_lng",
] as const;

const TRIP_STOPS_HEADER = [
  "trip_id",
  "stop_id",
  "position",
  "customer_id",
  "customer_name",
  "address",
  "city",
  "state",
  "zip",
  "country",
  "status",
  "delivered_at",
  "skipped_reason",
  "updated_by",
  "updated_at",
] as const;

const DELIVERY_HISTORY_HEADER = [
  "history_id",
  "trip_id",
  "trip_date",
  "customer_id",
  "customer_name",
  "status",
  "delivered_at",
  "skipped_reason",
  "driver",
  "submitted_at",
] as const;

const HOUSTON_TIMEZONE = "America/Chicago";

function nowHoustonTimestamp(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: HOUSTON_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")} America/Chicago`;
}

function todayHoustonDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: HOUSTON_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function asNumber(value: string, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeStatus(value: string): StopStatus {
  if (value === "delivered" || value === "skipped") {
    return value;
  }
  return "pending";
}

function makeAddress(customer: Customer): string {
  return [customer.addressLine1, customer.city, customer.state, customer.zip]
    .filter(Boolean)
    .join(", ");
}

function parseTripRows(rows: Record<string, string>[]): Omit<Trip, "stops">[] {
  return rows
    .map((row) => ({
      tripId: row.trip_id || row.id || "",
      tripDate: row.trip_date || "",
      createdBy: row.created_by || "",
      startedAt: row.started_at || "",
      submittedAt: row.submitted_at || "",
      status: (row.status as TripStatus) || "draft",
      warehouseAddress: row.warehouse_address || "",
      warehouseLat: row.warehouse_lat || "",
      warehouseLng: row.warehouse_lng || "",
    }))
    .filter((trip) => trip.tripId);
}

function parseStopRows(rows: Record<string, string>[]): TripStop[] {
  return rows
    .map((row) => ({
      tripId: row.trip_id || "",
      stopId: row.stop_id || "",
      position: asNumber(row.position, 0),
      customerId: row.customer_id || "",
      customerName: row.customer_name || "",
      address: row.address || "",
      city: row.city || "",
      state: row.state || "",
      zip: row.zip || "",
      country: row.country || "",
      status: normalizeStatus(row.status),
      deliveredAt: row.delivered_at || "",
      skippedReason: row.skipped_reason || "",
      updatedBy: row.updated_by || "",
      updatedAt: row.updated_at || "",
    }))
    .filter((stop) => stop.tripId && stop.stopId);
}

function serializeTripsRows(trips: Omit<Trip, "stops">[]): string[][] {
  return trips.map((trip) => [
    trip.tripId,
    trip.tripDate,
    trip.createdBy,
    trip.startedAt,
    trip.submittedAt,
    trip.status,
    trip.warehouseAddress,
    trip.warehouseLat,
    trip.warehouseLng,
  ]);
}

function serializeStopsRows(stops: TripStop[]): string[][] {
  return stops.map((stop) => [
    stop.tripId,
    stop.stopId,
    String(stop.position),
    stop.customerId,
    stop.customerName,
    stop.address,
    stop.city,
    stop.state,
    stop.zip,
    stop.country,
    stop.status,
    stop.deliveredAt,
    stop.skippedReason,
    stop.updatedBy,
    stop.updatedAt,
  ]);
}

function serializeDeliveryHistoryRows(rows: DeliveryHistoryRow[]): string[][] {
  return rows.map((item) => [
    item.historyId,
    item.tripId,
    item.tripDate,
    item.customerId,
    item.customerName,
    item.status,
    item.deliveredAt,
    item.skippedReason,
    item.driver,
    item.submittedAt,
  ]);
}

async function readAllTripsData() {
  const [tripRows, stopRows] = await Promise.all([
    readSheetRows(getTabName("trips")),
    readSheetRows(getTabName("tripStops")),
  ]);

  const trips = parseTripRows(tripRows);
  const stops = parseStopRows(stopRows);
  return { trips, stops };
}

function buildTripView(
  trip: Omit<Trip, "stops">,
  allStops: TripStop[],
): Trip {
  const stops = allStops
    .filter((stop) => stop.tripId === trip.tripId)
    .sort((a, b) => a.position - b.position);
  return { ...trip, stops };
}

function attachStops(
  trips: Omit<Trip, "stops">[],
  allStops: TripStop[],
): Trip[] {
  return trips.map((trip) => buildTripView(trip, allStops));
}

function ensureDraft(trip: Omit<Trip, "stops">) {
  if (trip.status !== "draft") {
    throw new Error("Trip is not editable after start.");
  }
}

export async function createDraftTrip(params: {
  customerIds: string[];
  createdBy: string;
  warehouseAddress: string;
}): Promise<Trip> {
  const uniqueCustomerIds = [...new Set(params.customerIds)];
  if (uniqueCustomerIds.length === 0) {
    throw new Error("Select at least one customer.");
  }

  const customers = await loadCustomers();
  const byId = new Map(customers.map((customer) => [customer.id, customer]));
  const selectedCustomers = uniqueCustomerIds
    .map((id) => byId.get(id))
    .filter((customer): customer is Customer => customer !== undefined);

  if (selectedCustomers.length === 0) {
    throw new Error("No valid customers found for route.");
  }

  const { trips, stops } = await readAllTripsData();
  const tripId = randomUUID();
  const newTrip: Omit<Trip, "stops"> = {
    tripId,
    tripDate: todayHoustonDate(),
    createdBy: params.createdBy,
    startedAt: "",
    submittedAt: "",
    status: "draft",
    warehouseAddress: params.warehouseAddress,
    warehouseLat: "",
    warehouseLng: "",
  };

  const timestamp = nowHoustonTimestamp();
  const newStops: TripStop[] = selectedCustomers.map((customer, index) => ({
    tripId,
    stopId: randomUUID(),
    position: index + 1,
    customerId: customer.id,
    customerName: customer.name,
    address: makeAddress(customer),
    city: customer.city,
    state: customer.state,
    zip: customer.zip,
    country: customer.country,
    status: "pending",
    deliveredAt: "",
    skippedReason: "",
    updatedBy: params.createdBy,
    updatedAt: timestamp,
  }));

  const nextTrips = [...trips, newTrip];
  const nextStops = [...stops, ...newStops];

  await Promise.all([
    replaceSheetRows(getTabName("trips"), [...TRIPS_HEADER], serializeTripsRows(nextTrips)),
    replaceSheetRows(
      getTabName("tripStops"),
      [...TRIP_STOPS_HEADER],
      serializeStopsRows(nextStops),
    ),
  ]);

  return { ...newTrip, stops: newStops };
}

export async function getTripById(tripId: string): Promise<Trip | null> {
  const { trips, stops } = await readAllTripsData();
  const trip = trips.find((item) => item.tripId === tripId);
  if (!trip) {
    return null;
  }
  return buildTripView(trip, stops);
}

export async function reorderTripStop(params: {
  tripId: string;
  stopId: string;
  direction: "up" | "down";
  actor: string;
}): Promise<Trip> {
  const { trips, stops } = await readAllTripsData();
  const trip = trips.find((item) => item.tripId === params.tripId);
  if (!trip) {
    throw new Error("Trip not found.");
  }
  ensureDraft(trip);

  const tripStops = stops
    .filter((stop) => stop.tripId === params.tripId)
    .sort((a, b) => a.position - b.position);
  const index = tripStops.findIndex((stop) => stop.stopId === params.stopId);
  if (index < 0) {
    throw new Error("Stop not found.");
  }
  const swapWith = params.direction === "up" ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= tripStops.length) {
    return buildTripView(trip, stops);
  }

  const nextStops = [...tripStops];
  const temp = nextStops[index];
  nextStops[index] = nextStops[swapWith];
  nextStops[swapWith] = temp;

  const stamped = nowHoustonTimestamp();
  const normalized = nextStops.map((stop, position) => ({
    ...stop,
    position: position + 1,
    updatedBy: params.actor,
    updatedAt: stamped,
  }));

  const otherStops = stops.filter((stop) => stop.tripId !== params.tripId);
  const fullStops = [...otherStops, ...normalized];

  await replaceSheetRows(
    getTabName("tripStops"),
    [...TRIP_STOPS_HEADER],
    serializeStopsRows(fullStops),
  );

  return buildTripView(trip, fullStops);
}

export async function removeTripStop(params: {
  tripId: string;
  stopId: string;
  actor: string;
}): Promise<Trip> {
  const { trips, stops } = await readAllTripsData();
  const trip = trips.find((item) => item.tripId === params.tripId);
  if (!trip) {
    throw new Error("Trip not found.");
  }
  ensureDraft(trip);

  const tripStops = stops
    .filter((stop) => stop.tripId === params.tripId && stop.stopId !== params.stopId)
    .sort((a, b) => a.position - b.position)
    .map((stop, index) => ({
      ...stop,
      position: index + 1,
      updatedBy: params.actor,
      updatedAt: nowHoustonTimestamp(),
    }));

  const otherStops = stops.filter((stop) => stop.tripId !== params.tripId);
  const fullStops = [...otherStops, ...tripStops];

  await replaceSheetRows(
    getTabName("tripStops"),
    [...TRIP_STOPS_HEADER],
    serializeStopsRows(fullStops),
  );

  return buildTripView(trip, fullStops);
}

export async function startTrip(params: {
  tripId: string;
  actor: string;
}): Promise<Trip> {
  const { trips, stops } = await readAllTripsData();
  const idx = trips.findIndex((item) => item.tripId === params.tripId);
  if (idx < 0) {
    throw new Error("Trip not found.");
  }
  ensureDraft(trips[idx]);

  const startedAt = nowHoustonTimestamp();
  const nextTrips = [...trips];
  nextTrips[idx] = {
    ...nextTrips[idx],
    status: "in_progress",
    startedAt,
  };

  await replaceSheetRows(
    getTabName("trips"),
    [...TRIPS_HEADER],
    serializeTripsRows(nextTrips),
  );

  return buildTripView(nextTrips[idx], stops);
}

export async function updateTripStopStatus(params: {
  tripId: string;
  stopId: string;
  status: StopStatus;
  skippedReason?: string;
  actor: string;
}): Promise<Trip> {
  const { trips, stops } = await readAllTripsData();
  const trip = trips.find((item) => item.tripId === params.tripId);
  if (!trip) {
    throw new Error("Trip not found.");
  }
  if (trip.status !== "in_progress") {
    throw new Error("Trip must be in progress.");
  }

  const timestamp = nowHoustonTimestamp();
  const fullStops = stops.map((stop) => {
    if (stop.tripId !== params.tripId || stop.stopId !== params.stopId) {
      return stop;
    }

    return {
      ...stop,
      status: params.status,
      deliveredAt: params.status === "delivered" ? timestamp : "",
      skippedReason: params.status === "skipped" ? params.skippedReason ?? "" : "",
      updatedBy: params.actor,
      updatedAt: timestamp,
    };
  });

  await replaceSheetRows(
    getTabName("tripStops"),
    [...TRIP_STOPS_HEADER],
    serializeStopsRows(fullStops),
  );

  return buildTripView(trip, fullStops);
}

export async function submitTrip(params: {
  tripId: string;
  actor: string;
}): Promise<Trip> {
  const { trips, stops } = await readAllTripsData();
  const tripIndex = trips.findIndex((item) => item.tripId === params.tripId);
  if (tripIndex < 0) {
    throw new Error("Trip not found.");
  }
  const trip = trips[tripIndex];
  if (trip.status !== "in_progress") {
    throw new Error("Trip must be in progress before submit.");
  }

  const tripStops = stops.filter((stop) => stop.tripId === params.tripId);
  const pending = tripStops.filter((stop) => stop.status === "pending");
  if (pending.length > 0) {
    throw new Error("All stops must be delivered or skipped before submit.");
  }

  const submittedAt = nowHoustonTimestamp();
  const nextTrips = [...trips];
  nextTrips[tripIndex] = {
    ...trip,
    status: "completed",
    submittedAt,
  };

  const historyRows = await readSheetRows(getTabName("deliveryHistory"));
  const existingHistory: DeliveryHistoryRow[] = historyRows
    .map((row) => ({
      historyId: row.history_id || row.id || "",
      tripId: row.trip_id || "",
      tripDate: row.trip_date || "",
      customerId: row.customer_id || "",
      customerName: row.customer_name || "",
      status: normalizeStatus(row.status),
      deliveredAt: row.delivered_at || "",
      skippedReason: row.skipped_reason || "",
      driver: row.driver || "",
      submittedAt: row.submitted_at || "",
    }))
    .filter((row) => row.historyId && row.tripId);

  const nextHistory = [
    ...existingHistory,
    ...tripStops.map((stop) => ({
      historyId: randomUUID(),
      tripId: trip.tripId,
      tripDate: trip.tripDate,
      customerId: stop.customerId,
      customerName: stop.customerName,
      status: stop.status,
      deliveredAt: stop.deliveredAt,
      skippedReason: stop.skippedReason,
      driver: params.actor,
      submittedAt,
    })),
  ];

  await Promise.all([
    replaceSheetRows(
      getTabName("trips"),
      [...TRIPS_HEADER],
      serializeTripsRows(nextTrips),
    ),
    replaceSheetRows(
      getTabName("deliveryHistory"),
      [...DELIVERY_HISTORY_HEADER],
      serializeDeliveryHistoryRows(nextHistory),
    ),
  ]);

  return buildTripView(nextTrips[tripIndex], stops);
}

export async function listDeliveryHistory(filters: {
  date?: string;
  customer?: string;
  driver?: string;
}): Promise<DeliveryHistoryRow[]> {
  const rows = await readSheetRows(getTabName("deliveryHistory"));
  const list: DeliveryHistoryRow[] = rows
    .map((row) => ({
      historyId: row.history_id || row.id || "",
      tripId: row.trip_id || "",
      tripDate: row.trip_date || "",
      customerId: row.customer_id || "",
      customerName: row.customer_name || "",
      status: normalizeStatus(row.status),
      deliveredAt: row.delivered_at || "",
      skippedReason: row.skipped_reason || "",
      driver: row.driver || "",
      submittedAt: row.submitted_at || "",
    }))
    .filter((item) => item.historyId && item.tripId);

  return list.filter((item) => {
    const byDate = filters.date ? item.tripDate === filters.date : true;
    const byCustomer = filters.customer
      ? item.customerName.toLowerCase().includes(filters.customer.toLowerCase())
      : true;
    const byDriver = filters.driver
      ? item.driver.toLowerCase().includes(filters.driver.toLowerCase())
      : true;
    return byDate && byCustomer && byDriver;
  });
}

export async function listTrips(): Promise<Trip[]> {
  const { trips, stops } = await readAllTripsData();
  return attachStops(trips, stops).sort((a, b) =>
    b.tripDate.localeCompare(a.tripDate),
  );
}
