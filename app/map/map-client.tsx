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

/** Lighter green = fewer locations in ZIP; darker green = more (same scale across all ZIPs). */
function densityFillColor(count: number, min: number, max: number): string {
  if (max <= 0) return "#e5e7eb";
  const t = max === min ? 1 : (count - min) / (max - min);
  const sat = 22 + t * 58;
  const light = 90 - t * 58;
  return `hsl(142, ${sat}%, ${light}%)`;
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
  const [geoJson, setGeoJson] = useState<GeoJSON.FeatureCollection | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState("");

  const zipBuckets = useMemo(() => aggregateByZip(markers), [markers]);

  /** Fetch ZIP polygons only when the set of ZIPs changes (not when counts alone change). */
  const sortedZipKey = useMemo(
    () => [...new Set(zipBuckets.map((b) => b.zip))].sort().join(","),
    [zipBuckets],
  );

  const densityRange = useMemo(() => {
    if (zipBuckets.length === 0) return { min: 0, max: 0 };
    const counts = zipBuckets.map((b) => b.count);
    return { min: Math.min(...counts), max: Math.max(...counts) };
  }, [zipBuckets]);

  const initMapPolygons = useCallback(
    (
      fc: GeoJSON.FeatureCollection,
      buckets: ZipBucket[],
      minC: number,
      maxC: number,
    ) => {
      if (!mapRef.current || !fc.features?.length || buckets.length === 0) return;

      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }

      const countByZip = new Map(buckets.map((b) => [b.zip, b.count]));
      const maxCount = maxC;

      const map = L.map(mapRef.current).setView([29.76, -95.37], 9);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(map);

      const styleFor = (feature: GeoJSON.Feature): L.PathOptions => {
        const zip = String(
          (feature.properties as Record<string, unknown> | null)?.ZCTA5 ?? "",
        );
        const count = countByZip.get(zip) ?? 0;
        return {
          fillColor: densityFillColor(count, minC, maxCount),
          fillOpacity: 0.52,
          color: "#15803d",
          weight: 1.25,
          opacity: 0.88,
        };
      };

      let geoLayer: L.GeoJSON;
      geoLayer = L.geoJSON(fc, {
        style: (feature) => styleFor(feature as GeoJSON.Feature),
        onEachFeature: (feature, layer) => {
          const zip = String(
            (feature.properties as Record<string, unknown> | null)?.ZCTA5 ?? "",
          );
          const count = countByZip.get(zip) ?? 0;
          layer.bindPopup(
            `<strong>ZIP ${escapeHtml(zip)}</strong><br>${count} customer${count === 1 ? "" : "s"} in this ZIP`,
          );
          layer.on({
            mouseover: (e) => {
              const lyr = e.target as L.Path;
              lyr.setStyle({
                fillOpacity: 0.72,
                weight: 2,
                color: "#166534",
              });
            },
            mouseout: (e) => {
              geoLayer.resetStyle(e.target);
            },
          });
        },
      }).addTo(map);

      const b = geoLayer.getBounds();
      if (b.isValid()) {
        map.fitBounds(b, { padding: [48, 48], maxZoom: 11 });
      }

      mapInstanceRef.current = map;
    },
    [],
  );

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
    if (loading || sortedZipKey.length === 0) {
      return;
    }
    let cancelled = false;
    setGeoLoading(true);
    setGeoError("");
    setGeoJson(null);

    void (async () => {
      try {
        const response = await fetch("/api/map-zip-geometries", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            zips: sortedZipKey.split(",").filter(Boolean),
          }),
        });
        if (!response.ok) {
          throw new Error("boundaries");
        }
        const data = (await response.json()) as GeoJSON.FeatureCollection;
        if (!cancelled) {
          if (!data.features?.length) {
            setGeoError("No ZIP area shapes returned. Try again later.");
          } else {
            setGeoJson(data);
          }
        }
      } catch {
        if (!cancelled) {
          setGeoError("Could not load ZIP area boundaries from the Census map service.");
        }
      } finally {
        if (!cancelled) setGeoLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loading, sortedZipKey]);

  useEffect(() => {
    if (
      loading ||
      geoLoading ||
      geoError ||
      !geoJson?.features?.length ||
      zipBuckets.length === 0
    ) {
      return;
    }
    initMapPolygons(geoJson, zipBuckets, densityRange.min, densityRange.max);
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [
    loading,
    geoLoading,
    geoError,
    geoJson,
    zipBuckets,
    densityRange.min,
    densityRange.max,
    initMapPolygons,
  ]);

  const canShowMap =
    !loading &&
    !error &&
    !geoLoading &&
    !geoError &&
    zipBuckets.length > 0 &&
    Boolean(geoJson?.features?.length);

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
                  Areas are real ZIP boundaries (Census ZCTA). Green fill: lighter = fewer
                  customers in that ZIP, darker = more.
                </>
              ) : meta ? (
                ""
              ) : null}
              {meta && meta.zipOnlyMode ? (
                <span>
                  {" "}
                  Customer positions use ZIP centroids for geocoding (fast mode). Set{" "}
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
                      "linear-gradient(to right, hsl(142, 28%, 92%), hsl(145, 72%, 24%))",
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
        ) : geoLoading ? (
          <p className={styles.meta}>Loading ZIP area outlines…</p>
        ) : geoError ? (
          <p className={styles.errorText}>{geoError}</p>
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
