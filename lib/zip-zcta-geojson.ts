/**
 * US Census TIGERweb — 2020 ZCTA (ZIP Code Tabulation Areas) polygons.
 * @see https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/PUMA_TAD_TAZ_UGA_ZCTA/MapServer/1
 */

const CENSUS_ZCTA_QUERY =
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/PUMA_TAD_TAZ_UGA_ZCTA/MapServer/1/query";

/** ArcGIS `IN` lists get long; keep batches modest for URL length and reliability. */
const BATCH_SIZE = 20;

function normalizeZip5(zip: string): string | null {
  const z = zip.trim().replace(/\D/g, "").slice(0, 5);
  return /^\d{5}$/.test(z) ? z : null;
}

export async function fetchZctaGeoJsonForZips(zips: string[]): Promise<GeoJSON.FeatureCollection> {
  const unique = [
    ...new Set(
      zips.map(normalizeZip5).filter((z): z is string => z !== null),
    ),
  ];
  const batches: string[][] = [];
  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    batches.push(unique.slice(i, i + BATCH_SIZE));
  }

  const batchResults = await Promise.all(
    batches.map(async (batch) => {
      const inList = batch.map((z) => `'${z}'`).join(",");
      const where = `ZCTA5 IN (${inList})`;
      const url = new URL(CENSUS_ZCTA_QUERY);
      url.searchParams.set("where", where);
      url.searchParams.set("outFields", "*");
      url.searchParams.set("f", "geojson");

      const response = await fetch(url.toString(), { cache: "no-store" });
      if (!response.ok) return [] as GeoJSON.Feature[];
      const fc = (await response.json()) as GeoJSON.FeatureCollection;
      return Array.isArray(fc.features) ? fc.features : [];
    }),
  );

  const features = batchResults.flat();
  return { type: "FeatureCollection", features };
}
