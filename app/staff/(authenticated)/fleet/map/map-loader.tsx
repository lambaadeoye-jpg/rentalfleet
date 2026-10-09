"use client";

import dynamic from "next/dynamic";
import type { MapPin } from "./fleet-map";

// Leaflet touches `window`, so it only loads in the browser.
const FleetMap = dynamic(() => import("./fleet-map"), {
  ssr: false,
  loading: () => <div className="map-frame" aria-busy="true" />,
});

export default function MapLoader({ pins }: { pins: MapPin[] }) {
  return <FleetMap pins={pins} />;
}
