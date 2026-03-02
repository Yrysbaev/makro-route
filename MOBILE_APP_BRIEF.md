# Makro Route – Mobile App Brief for AI Mobile Development Agent

This document describes the **Makro Route** web application in full detail so you can build a **native or cross-platform mobile version** that uses the same backend (Next.js APIs) and behaves consistently.

---

## 1. What the app does

**Makro Route** is a **route planning and delivery execution** app for a wholesale company (Makro Food). Typical use: **10–15 delivery stops per day**.

- **Dispatchers/office** use it to: load customers, select stops, **optimize the route** (minimize driving time/distance), review the ordered list, then **start a trip** for a driver.
- **Drivers** use it to: see their **trip in progress** (ordered list of stops), open each address in maps, mark each stop as **Delivered** or **Skipped**, then **submit the trip** when done.
- All **trips and delivery history** are stored in **Google Sheets** (backend uses Google Sheets as the database).

The web app is built with **Next.js 16** and deployed (e.g. Vercel). The **mobile app should call the same HTTP APIs** and can be built with React Native, Flutter, or native iOS/Android.

---

## 2. User roles and flows

There are no separate “dispatcher” vs “driver” accounts in the backend: **the same login works for both**. The flow differs by screen:

- **Planner flow (dispatcher/office):** Login → Customer Picker (search, select customers) → Set start/end address → Create Route (optimize + create trip) → Route Review (see stops, move/remove, mileage/time) → **Go to Trip** (navigate to driver screen for that trip).
- **Driver flow:** Login → Either open an **in-progress trip** (e.g. from a link or list) → See list of stops → For each stop: **Navigate** (open in maps), **Delivered** or **Skipped** → When all stops are delivered/skipped → **Submit Trip** → See trip summary.
- **History:** Any logged-in user can open **History** and filter by date, customer name, or driver.

The mobile app can:
- Implement **both** planner and driver flows (same as web), or
- Implement **only the driver flow** (trip list + trip execution + submit) if planners keep using the web app.

---

## 3. Authentication

- **Login:** Username + password. No sign-up; accounts are fixed in the backend.
- **Session:** After successful login, the server sets an **HTTP-only cookie** (`makro_route_session`) with a **signed JWT-like token** (payload + HMAC-SHA256 signature). Session TTL: **12 hours**.
- **Mobile:** Web uses cookies. For mobile you have two options:
  1. **Cookie storage:** If your HTTP client supports cookies (e.g. WebView or a client that stores cookies), use the same cookie. Login with `POST /api/auth/login` and send the `Cookie` header on every request.
  2. **Token in body/header:** The current backend does **not** return the token in the JSON body; it only sets a cookie. To support mobile cleanly, you could either:
     - Add a small backend change: on login success, also return `{ user, token }` and support `Authorization: Bearer <token>` on protected routes, or
     - Use a WebView for the app and let the server set cookies as it does today (simplest, same as web).

**Driver accounts (current, case-insensitive username):**

| Username           | Password |
|--------------------|----------|
| Maksatbek_K        | Makro1   |
| Zhakshylyk         | Makro2   |
| Seyitbek           | Makro3   |
| Maksatbek_Yrysbaev | Makro4   |
| Office             | Makro5   |

**Endpoints:**

- `POST /api/auth/login`  
  - Body: `{ "username": string, "password": string }`  
  - Success: `200`, `{ user: { username, fullName } }`, and `Set-Cookie: makro_route_session=...`  
  - Failure: `401` `{ error: "Invalid username or password" }`

- `POST /api/auth/logout`  
  - No body. Clears session cookie. Call after login to “log out” (mobile can clear local token/cookie store).

**Protected APIs:** All other APIs require the session cookie (or, if you add it, `Authorization: Bearer <token>`). Missing/invalid auth → `401 { error: "Unauthorized" }`.

---

## 4. Base URL and API summary

- **Base URL:** Your deployed Next.js app, e.g. `https://your-app.vercel.app`.
- All request/response bodies are **JSON** unless noted.
- All protected routes need the session **cookie** (or Bearer token if you extend the backend).

| Method | Path | Purpose |
|--------|------|---------|
| POST   | `/api/auth/login`   | Login (username, password) |
| POST   | `/api/auth/logout`  | Logout |
| GET    | `/api/customers`   | List all customers |
| POST   | `/api/optimize-route` | Optimize order of selected customers; returns ordered list + metrics |
| POST   | `/api/route-distance` | Get total mileage/duration for a given ordered list (start → stops → end) |
| GET    | `/api/trips`       | List all trips |
| POST   | `/api/trips`       | Create draft trip (customerIds, warehouseAddress) |
| GET    | `/api/trips/:tripId` | Get one trip with stops |
| PATCH  | `/api/trips/:tripId/reorder` | Move stop up/down (draft only) |
| DELETE | `/api/trips/:tripId/stops/:stopId` | Remove stop (draft only) |
| PATCH  | `/api/trips/:tripId/start` | Start trip (draft → in_progress) |
| PATCH  | `/api/trips/:tripId/stops/:stopId/status` | Set stop status: delivered / skipped |
| PATCH  | `/api/trips/:tripId/submit` | Submit completed trip |
| GET    | `/api/history`     | Delivery history (query: date, customer, driver) |

---

## 5. API contracts (request/response)

### 5.1 Customers

**GET /api/customers**

- Response: `{ customers: Customer[] }`
- `Customer`: `{ id, name, addressLine1, city, state, country, zip }`

---

### 5.2 Optimize route

**POST /api/optimize-route**

- Body:
  - `customers: Customer[]` – selected customers (same shape as above)
  - `warehouseAddress?: string` – start address (e.g. warehouse)
  - `endAddress?: string` – end/return address (defaults to warehouse if omitted)
  - `startLatitude?`, `startLongitude?` – optional; if set, used as start instead of geocoding warehouse
- Response (success):  
  `{ customers: Customer[], totalKm, totalSeconds, legEtas: [{ stopId, customerName, legDurationSec, legDistanceKm, etaHouston }], warnings: string[], unresolvedStops, averageGeocodeQuality }`
- `customers` is in **optimized order**. Stops that could not be geocoded are **appended** in selection order; `warnings` may mention them.
- Errors: `500` with `{ error: string }` (e.g. timeout, geocoding failure).

---

### 5.3 Route distance (mileage/duration for a given order)

**POST /api/route-distance**

- Body:
  - `customers: Customer[]` – **in the order** you want (e.g. after reorder or from optimize)
  - `warehouseAddress?: string` – start address
  - `endAddress?: string` – end address (defaults to warehouse if omitted)
- Response: `{ totalKm, totalSeconds, unresolvedStops }`
- Used to show mileage/time when user reorders stops or when you want to display “from warehouse → stops → end”.

---

### 5.4 Trips

**GET /api/trips**

- Response: `{ trips: Trip[] }` (each `Trip` includes `stops: TripStop[]`).

**POST /api/trips**

- Body: `{ customerIds: string[], warehouseAddress: string }`
- `customerIds`: array of `Customer.id` in the **order** you want (typically the order returned by optimize-route, possibly with non-geocoded appended).
- Response: `{ trip: Trip }`. Trip is in status `draft`.

**GET /api/trips/:tripId**

- Response: `{ trip: Trip }` with full `stops` array.

**PATCH /api/trips/:tripId/reorder**

- Body: `{ stopId: string, direction: "up" | "down" }`
- Only for `draft` trips. Response: `{ trip: Trip }`.

**DELETE /api/trips/:tripId/stops/:stopId**

- No body. Only for `draft` trips. Response: `{ trip: Trip }`.

**PATCH /api/trips/:tripId/start**

- No body. Transitions trip from `draft` to `in_progress`. Response: `{ trip: Trip }`.

**PATCH /api/trips/:tripId/stops/:stopId/status**

- Body: `{ status: "delivered" | "skipped", skippedReason?: string }`
- Only for `in_progress` trips. When status is `skipped`, `skippedReason` can be sent. Response: `{ trip: Trip }`.

**PATCH /api/trips/:tripId/submit**

- No body. Only when **all** stops are `delivered` or `skipped`. Transitions trip to `completed`. Response: `{ trip: Trip }`.

**Trip and TripStop types:**

- **Trip:**  
  `tripId`, `tripDate`, `createdBy`, `startedAt`, `submittedAt`, `status` (`"draft" | "in_progress" | "completed"`), `warehouseAddress`, `warehouseLat`, `warehouseLng`, `stops: TripStop[]`
- **TripStop:**  
  `stopId`, `position`, `customerId`, `customerName`, `address`, `city`, `state`, `zip`, `country`, `status` (`"pending" | "delivered" | "skipped"`), `deliveredAt`, `skippedReason`, `updatedBy`, `updatedAt`

All timestamps are stored in **Houston time** (America/Chicago) on the server.

---

### 5.5 History

**GET /api/history?date=YYYY-MM-DD&customer=...&driver=...**

- Query params optional. Response: `{ rows: DeliveryHistoryRow[] }`
- Each row: `historyId`, `tripId`, `tripDate`, `customerId`, `customerName`, `status`, `deliveredAt`, `skippedReason`, `driver`, `submittedAt`.

---

## 6. Main UI flows (for parity)

### 6.1 Login screen

- Fields: username, password.
- Submit → `POST /api/auth/login`. On success, store session (cookie or token) and go to home. On 401, show error.

### 6.2 Home / Planner (dispatcher)

- **Customer list:** From `GET /api/customers`. Show search box; when user types, filter by name, city, state, address, zip. **When searching, hide already-selected customers** so the list is shorter. When not searching, show **selected customers at the top** (in selection order), then the rest.
- **Selection:** Tap to add/remove a customer. Keep `selectedIds` (or equivalent) in order.
- **Addresses:** Two fields – “Start (warehouse) address” and “End (return) address”. Default both to the same warehouse (e.g. “5072 Steadmont Dr, Houston, TX 77040”). Mileage is always **start → stops in order → end**.
- **Create Route:**  
  1. `POST /api/optimize-route` with `customers` (selected), `warehouseAddress`, `endAddress`.  
  2. From response take `customers` (ordered). If some were not geocoded, they are appended; you can show a warning.  
  3. Build `customerIds` in that order (including non-geocoded).  
  4. `POST /api/trips` with `customerIds` and `warehouseAddress`.  
  5. Show the new trip in “Route Review” and metrics (mileage, total travel time, ETA, warnings).
- **Route Review:** Show trip’s stops in order. For **draft** trips: Move up / Move down / Remove per stop. After move/remove, call reorder or delete API, then optionally `POST /api/route-distance` with current stop order to refresh mileage/time.
- **Go to Trip:** `PATCH /api/trips/:tripId/start`, then navigate to the **Trip in progress** screen for that `tripId`.

### 6.3 Trip in progress (driver)

- Load trip: `GET /api/trips/:tripId`. Show list of stops (position, customer name, address, status).
- **Navigate:** Open the stop’s address in the device maps app (e.g. `geo:` or maps URL).
- **Delivered:** `PATCH .../stops/:stopId/status` with `{ status: "delivered" }`. Update local state from response.
- **Skipped:** Same with `{ status: "skipped", skippedReason?: "..." }` if you collect a reason.
- **Submit Trip:** Enabled only when every stop is `delivered` or `skipped`. `PATCH /api/trips/:tripId/submit`. Then navigate to trip summary (or history).

### 6.4 Trip summary (after submit)

- Same `GET /api/trips/:tripId`. Show trip date, submitted time, counts (delivered / skipped), list of stops with status. Read-only.

### 6.5 History

- `GET /api/history` with optional filters (date, customer name, driver). Display rows in a list or table.

---

## 7. Business rules (backend)

- **Draft:** Only reorder and remove stops when `status === "draft"`. Starting the trip makes it `in_progress` and locks structure.
- **Submit:** All stops must be `delivered` or `skipped` before submit. Backend enforces this.
- **Optimization:** Server uses OSRM (real road network) and geocoding (Nominatim + US Census). Some addresses may fail to geocode; they are still included in the trip at the end of the list and flagged in `warnings`.
- **Mileage:** Always computed as **warehouse (start) → stops in order → end address**. If no end address is sent, backend uses warehouse (return to start).

---

## 8. Data persistence (backend)

- **Customers:** Loaded from **Google Sheets** (tab “customers”). If Sheets is not configured or empty, backend can fall back to a local JSON file. Mobile only calls `GET /api/customers`; it does not manage Sheets.
- **Trips and delivery history:** Stored in **Google Sheets** (tabs: trips, trip_stops, delivery_history). Creating/updating trips and submitting them is done via the APIs above; mobile does not talk to Sheets directly.

---

## 9. What the mobile app must do (summary)

1. **Auth:** Login with username/password; send session cookie (or Bearer token if you add it) on every API request.
2. **Customers:** Load and display; search; maintain selection with “selected at top when not searching” and “hide selected when searching”.
3. **Planner:** Start/end addresses → Create Route (optimize + create trip) → Route Review (reorder/remove for draft) → refresh mileage after changes → Start trip.
4. **Driver:** Load trip → show stops → Navigate (maps) → Delivered/Skipped per stop → Submit when all done.
5. **History:** Optional; list/filter delivery history.
6. **Errors:** Show API error messages (e.g. `error` in JSON) and handle 401 (re-login or logout).

Use the same **base URL** as the web app so the mobile app hits the same Next.js API routes. No separate backend is required for the mobile version.

---

## 10. Optional backend change for mobile auth

If you prefer **token-based auth** instead of cookies:

- In `POST /api/auth/login`, on success, also return `{ user, token }` where `token` is the same value stored in the cookie.
- In protected API routes, accept either the existing cookie or `Authorization: Bearer <token>` and verify the same token. Then the mobile app can store `token` in secure storage and send it in the header for every request.

This brief is intended to be given to an AI mobile development agent (or a human developer) to implement a mobile version of Makro Route that reuses the existing web backend and behavior.
