"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useRouter } from "next/navigation";
import styles from "../page.module.css";

type MapPinSource = "census" | "nominatim" | "zip";

type MapMarker = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  city: string;
  state: string;
  zip: string;
  source?: MapPinSource;
};

type ZipBucket = {
  zip: string;
  lat: number;
  lng: number;
  count: number;
};

function normalizeZip(zip: string): string {
  return zip.trim().replace(/\D/g, "").slice(0, 5);
}

/** One point per US ZIP; position is mean of all customer pins in that ZIP. */
function aggregateByZip(markers: MapMarker[]): ZipBucket[] {
  const map = new Map<string, { sumLat: number; sumLng: number; count: number }>();
  for (const m of markers) {
    const z = normalizeZip(m.zip);
    if (!/^\d{5}$/.test(z)) continue;
    const cur = map.get(z) ?? { sumLat: 0, sumLng: 0, count: 0 };
    cur.sumLat += m.lat;
    cur.sumLng += m.lng;
    cur.count += 1;
    map.set(z, cur);
  }
  return [...map.entries()]
    .map(([zip, v]) => ({
      zip,
      lat: v.sumLat / v.count,
      lng: v.sumLng / v.count,
      count: v.count,
    }))
    .sort((a, b) => a.zip.localeCompare(b.zip));
}

/** Lighter = fewer locations in ZIP; darker = more (same scale across all ZIPs). */
function densityFillColor(count: number, min: number, max: number): string {
  if (max <= 0) return "#e5e7eb";
  const t = max === min ? 1 : (count - min) / (max - min);
  const hue = 48 - t * 26;
  const sat = 28 + t * 58;
  const light = 90 - t * 58;
  return `hsl(${hue}, ${sat}%, ${light}%)`;
}

function densityRadius(count: number, max: number): number {
  if (max <= 0) return 8;
  return 6 + Math.sqrt(count / max) * 22;
}

export default function MapClient() {
  const router = useRouter();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const [markers, setMarkers] = useState<MapMarker[]>([]);
  const [meta, setMeta] = useState<{
    total: number;
    skipped: number;
    zipFallbackCount: number;
    nominatimCutShort: boolean;
    zipOnlyMode: boolean;
  } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const zipBuckets = useMemo(() => aggregateByZip(markers), [markers]);

  const densityRange = useMemo(() => {
    if (zipBuckets.length === 0) return { min: 0, max: 0 };
    const counts = zipBuckets.map((b) => b.count);
    return { min: Math.min(...counts), max: Math.max(...counts) };
  }, [zipBuckets]);

  const initMap = useCallback((buckets: ZipBucket[], minC: number, maxC: number) => {
    if (!mapRef.current || buckets.length === 0) return;

    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    const map = L.map(mapRef.current).setView([29.76, -95.37], 9);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);

    const bounds = L.latLngBounds([]);

    for (const b of buckets) {
      const fill = densityFillColor(b.count, minC, maxC);
      const radius = densityRadius(b.count, maxC);
      const marker = L.circleMarker([b.lat, b.lng], {
        radius,
        color: "#ffffff",
        weight: 2,
        fillColor: fill,
        fillOpacity: 0.92,
      }).addTo(map);
      marker.bindPopup(
        `<strong>ZIP ${escapeHtml(b.zip)}</strong><br>${b.count} customer${b.count === 1 ? "" : "s"} in this ZIP`,
      );
      bounds.extend([b.lat, b.lng]);
    }

    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
    }

    mapInstanceRef.current = map;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const MAP_FETCH_TIMEOUT_MS = 300_000;
    const timeoutId = window.setTimeout(() => controller.abort(), MAP_FETCH_TIMEOUT_MS);

    async function load() {
      setError("");
      try {
        const response = await fetch("/api/customers-map", {
          cache: "no-store",
          signal: controller.signal,
        });

        if (response.status === 401) {
          if (!cancelled) {
            setError("Your session expired. Redirecting to sign in…");
            router.replace("/login");
          }
          return;
        }

        if (!response.ok) {
          let detail = "Could not load customer locations.";
          try {
            const body = (await response.json()) as { error?: string };
            if (typeof body.error === "string" && body.error.trim()) {
              detail = body.error.trim();
            }
          } catch {
            if (response.status === 504 || response.status === 502) {
              detail =
                "The map server took too long to respond. Try again in a moment, or ask your admin to check hosting time limits.";
            }
          }
          if (!cancelled) setError(detail);
          return;
        }

        const data = (await response.json()) as {
          markers?: MapMarker[];
          totalCustomers?: number;
          skippedNoZip?: number;
          zipFallbackCount?: number;
          nominatimCutShort?: boolean;
          zipOnlyMode?: boolean;
        };
        if (cancelled) return;
        setMarkers(Array.isArray(data.markers) ? data.markers : []);
        setMeta({
          total: data.totalCustomers ?? 0,
          skipped: data.skippedNoZip ?? 0,
          zipFallbackCount: data.zipFallbackCount ?? 0,
          nominatimCutShort: data.nominatimCutShort ?? false,
          zipOnlyMode: data.zipOnlyMode ?? false,
        });
      } catch (err) {
        if (!cancelled) {
          const aborted =
            err instanceof DOMException && err.name === "AbortError";
          setError(
            aborted
              ? "The map request timed out (5 minute limit). Try again. For a fast map on Vercel, leave MAP_STREET_GEOCODE unset (ZIP-only pins). Street-level geocoding can take many minutes."
              : "Could not load customer locations. Check your network and try again.",
          );
        }
      } finally {
        window.clearTimeout(timeoutId);
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [router]);

  useEffect(() => {
    if (!loading && zipBuckets.length > 0) {
      initMap(zipBuckets, densityRange.min, densityRange.max);
    }
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [loading, zipBuckets, densityRange.min, densityRange.max, initMap]);

  const canShowMap = !loading && !error && zipBuckets.length > 0;

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <div>
            <h1>Customer map</h1>
            <p className={styles.meta}>
              {meta && markers.length > 0 ? (
                <>
                  {zipBuckets.length} ZIP areas · {markers.length} locations plotted
                  {meta.total !== markers.length ? ` (of ${meta.total} customers)` : ""}.
                  Circle color: lighter = fewer locations in that ZIP, darker = more. Size also
                  reflects volume slightly.
                </>
              ) : meta ? (
                ""
              ) : null}
              {meta && meta.zipOnlyMode ? (
                <span>
                  {" "}
                  Pin positions use ZIP centroids (fast mode). Set{" "}
                  <code>MAP_STREET_GEOCODE=1</code> for street-level coordinates.
                </span>
              ) : null}
              {meta && !meta.zipOnlyMode && meta.zipFallbackCount > 0 ? (
                <span>
                  {" "}
                  {meta.zipFallbackCount === 1
                    ? "One location uses a ZIP centroid only."
                    : `${meta.zipFallbackCount} locations use ZIP centroids only.`}
                </span>
              ) : null}
              {meta && !meta.zipOnlyMode && meta.nominatimCutShort ? (
                <span>
                  {" "}
                  Street lookup stopped early for some rows; those use ZIP centroids.
                </span>
              ) : null}
              {meta && meta.skipped > 0 ? (
                <span> {meta.skipped} could not be placed (missing or invalid US ZIP).</span>
              ) : null}
            </p>
            {canShowMap ? (
              <p className={styles.meta} style={{ marginTop: 8 }}>
                <span style={{ marginRight: 10, verticalAlign: "middle" }}>Fewer</span>
                <span
                  style={{
                    display: "inline-block",
                    width: 180,
                    height: 12,
                    borderRadius: 4,
                    verticalAlign: "middle",
                    border: "1px solid #cbd5e1",
                    background:
                      "linear-gradient(to right, hsl(48, 28%, 90%), hsl(22, 86%, 32%))",
                  }}
                />
                <span style={{ marginLeft: 10, verticalAlign: "middle" }}>More</span>
                {densityRange.max > 0 ? (
                  <span style={{ marginLeft: 12, opacity: 0.85 }}>
                    Range: {densityRange.min}–{densityRange.max} per ZIP
                  </span>
                ) : null}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className={styles.btnMuted}
            onClick={() => router.push("/")}
          >
            Back to planner
          </button>
        </header>

        {error ? <p className={styles.errorText}>{error}</p> : null}

        {loading ? (
          <p className={styles.meta}>Loading map…</p>
        ) : error ? null : markers.length === 0 ? (
          <p className={styles.meta}>
            No customers with locations to show. Add customers with a US ZIP code, or fix rows
            that could not be geocoded.
          </p>
        ) : zipBuckets.length === 0 ? (
          <p className={styles.meta}>
            No valid US ZIP codes to group. Check that customer rows include 5-digit ZIPs.
          </p>
        ) : (
          <div
            ref={mapRef}
            style={{
              width: "100%",
              height: "min(70vh, 600px)",
              borderRadius: 12,
              border: "1px solid #d4e0ee",
            }}
          />
        )}
      </main>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
