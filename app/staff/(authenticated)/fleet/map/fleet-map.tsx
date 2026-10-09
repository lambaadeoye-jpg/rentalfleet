"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export type MapPin = {
  id: string;
  name: string;
  plate: string | null;
  renter: string | null;
  lat: number;
  lng: number;
  color: string;
  stateLabel: string;
  seen: string;
  speed: number | null;
  mapsUrl: string;
};

const NASHVILLE: L.LatLngExpression = [36.1627, -86.7816];

// Text goes in through textContent, never innerHTML, so a plate or name can't inject markup.
function popupFor(pin: MapPin): HTMLElement {
  const root = document.createElement("div");
  root.style.cssText = "font:13px/1.45 Inter,system-ui,sans-serif;min-width:170px";
  const add = (text: string, style = "") => {
    const el = document.createElement("div");
    el.textContent = text;
    if (style) el.style.cssText = style;
    root.appendChild(el);
  };
  add(pin.name, "font-weight:700;font-size:14px");
  if (pin.plate) add(pin.plate, "color:#667085");
  if (pin.renter) add(`Renter: ${pin.renter}`);
  add(`${pin.stateLabel} · ${pin.seen}${pin.speed ? ` · ${Math.round(pin.speed)} mph` : ""}`, "color:#667085;margin-top:4px");
  const link = document.createElement("a");
  link.href = pin.mapsUrl;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "Open in Google Maps";
  link.style.cssText = "display:inline-block;margin-top:6px;color:#087f78;font-weight:600";
  root.appendChild(link);
  return root;
}

export default function FleetMap({ pins }: { pins: MapPin[] }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!container.current || mapRef.current) return;
    const map = L.map(container.current, { zoomControl: true }).setView(NASHVILLE, 10);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    for (const pin of pins) {
      const icon = L.divIcon({
        className: "",
        html: `<div class="map-pin" style="background:${pin.color}"></div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      });
      L.marker([pin.lat, pin.lng], { icon, title: pin.plate ?? pin.name }).bindPopup(popupFor(pin)).addTo(layer);
    }
    if (pins.length > 0) {
      map.fitBounds(L.latLngBounds(pins.map((p) => [p.lat, p.lng] as [number, number])), { padding: [48, 48], maxZoom: 14 });
    }
  }, [pins]);

  return <div ref={container} className="map-frame" role="region" aria-label="Map of fleet locations" />;
}
