"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

const SOURCE_LABEL: Record<MapPinSource, string> = {
  census: "Street (US Census)",
  nominatim: "Street (OpenStreetMap)",
  zip: "ZIP area (approximate)",
};

const SOURCE_COLOR: Record<MapPinSource, string> = {
  census: "#16a34a",
  nominatim: "#2563eb",
  zip: "#d97706",
};

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

  const initMap = useCallback((data: MapMarker[]) => {
    if (!mapRef.current || data.length === 0) return;

    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    const map = L.map(mapRef.current).setView([29.76, -95.37], 9);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);

    const bounds = L.latLngBounds([]);

    for (const m of data) {
      const source: MapPinSource = m.source ?? "zip";
      const fill = SOURCE_COLOR[source];
      const marker = L.circleMarker([m.lat, m.lng], {
        radius: 9,
        color: "#ffffff",
        weight: 2,
        fillColor: fill,
        fillOpacity: 0.92,
      }).addTo(map);
      const label = SOURCE_LABEL[source];
      marker.bindPopup(
        `<strong>${escapeHtml(m.name)}</strong><br>${escapeHtml(m.city)}, ${escapeHtml(m.state)} ${escapeHtml(m.zip)}<br><span style="font-size:12px;opacity:.85">${escapeHtml(label)}</span>`,
      );
      bounds.extend([m.lat, m.lng]);
    }

    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
    }

    mapInstanceRef.current = map;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 118_000);

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
              ? "Loading the map timed out. Try again, or ask your admin to check server time limits if you have many customers."
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
    if (!loading && markers.length > 0) {
      initMap(markers);
    }
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [loading, markers, initMap]);

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <div>
            <h1>Customer map</h1>
            <p className={styles.meta}>
              {meta
                ? `${markers.length} pins on the map (of ${meta.total} customers).`
                : ""}
              {meta && meta.zipOnlyMode ? (
                <span>
                  {" "}
                  Pins are placed using each customer’s ZIP code from your data (center of
                  that ZIP area — not the exact street). All orange pins are
                  expected in this mode. Street address geocoding is turned off on the server
                  so the map loads quickly on Vercel. To try Census/OpenStreetMap street pins
                  instead, set env <code>MAP_STREET_GEOCODE=1</code> and use a hosting plan
                  with a long enough function timeout (e.g. Vercel Pro).
                </span>
              ) : (
                <>
                  {meta
                    ? " Green: street-level (US Census). Blue: street-level (OpenStreetMap). Orange: ZIP centroid only (approximate)."
                    : ""}
                  {meta && meta.zipFallbackCount > 0 ? (
                    <span>
                      {" "}
                      {meta.zipFallbackCount === 1
                        ? "One location uses a ZIP centroid only."
                        : `${meta.zipFallbackCount} locations use ZIP centroids only.`}
                    </span>
                  ) : null}
                  {meta && meta.nominatimCutShort ? (
                    <span>
                      {" "}
                      Street lookup (OpenStreetMap) stopped early for some rows due to a time
                      limit; those use ZIP centroids instead. Refresh to retry.
                    </span>
                  ) : null}
                </>
              )}
              {meta && meta.skipped > 0 ? (
                <span> {meta.skipped} could not be placed (missing or invalid US ZIP).</span>
              ) : null}
            </p>
            {meta && markers.length > 0 ? (
              <p className={styles.meta} style={{ marginTop: 4 }}>
                <span
                  style={{
                    display: "inline-block",
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: SOURCE_COLOR.census,
                    marginRight: 6,
                    verticalAlign: "middle",
                  }}
                />
                Census
                <span
                  style={{
                    display: "inline-block",
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: SOURCE_COLOR.nominatim,
                    margin: "0 6px 0 12px",
                    verticalAlign: "middle",
                  }}
                />
                OSM
                <span
                  style={{
                    display: "inline-block",
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: SOURCE_COLOR.zip,
                    margin: "0 6px 0 12px",
                    verticalAlign: "middle",
                  }}
                />
                ZIP only
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
