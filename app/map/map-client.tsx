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

    async function load() {
      setError("");
      try {
        const response = await fetch("/api/customers-map", { cache: "no-store" });
        if (!response.ok) {
          throw new Error("Failed to load map data");
        }
        const data = (await response.json()) as {
          markers?: MapMarker[];
          totalCustomers?: number;
          skippedNoZip?: number;
          zipFallbackCount?: number;
        };
        if (cancelled) return;
        setMarkers(Array.isArray(data.markers) ? data.markers : []);
        setMeta({
          total: data.totalCustomers ?? 0,
          skipped: data.skippedNoZip ?? 0,
          zipFallbackCount: data.zipFallbackCount ?? 0,
        });
      } catch {
        if (!cancelled) setError("Could not load customer locations.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

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
                ? `${markers.length} pins on the map (of ${meta.total} customers). Green: street-level (US Census). Blue: street-level (OpenStreetMap). Orange: ZIP centroid only (approximate).`
                : ""}
              {meta && meta.zipFallbackCount > 0 ? (
                <span>
                  {" "}
                  {meta.zipFallbackCount === 1
                    ? "One location uses a ZIP centroid only."
                    : `${meta.zipFallbackCount} locations use ZIP centroids only.`}
                </span>
              ) : null}
              {meta && meta.skipped > 0 ? (
                <span> {meta.skipped} could not be placed.</span>
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
        ) : markers.length === 0 ? (
          <p className={styles.meta}>No customers with valid US ZIP codes to show.</p>
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
