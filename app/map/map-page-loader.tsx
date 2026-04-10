"use client";

import dynamic from "next/dynamic";

const MapClient = dynamic(() => import("./map-client"), { ssr: false });

export default function MapPageLoader() {
  return <MapClient />;
}
