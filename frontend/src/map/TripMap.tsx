/**
 * TripMap — Leaflet + OpenStreetMap tiles with the pickup, the destination and, while
 * the trip is being tracked, the driver's car gliding along (docs/REALTIME.md).
 *
 * The car follows the raw positions through {@link createSmoothMarker}. When
 * `VITE_OSRM_URL` is set, the recent trail is also snapped to roads and drawn as a
 * line; snapped points are display-only.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, Polyline, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { appConfig } from "../config/appConfig";
import { resolveDriverClient } from "../domain/driver";
import type { TripResponse } from "../domain/trip";
import { resolveUrl } from "../http/resolveUrl";
import { createRoadSnapper } from "./roadSnapper";
import type { LatLng } from "./roadSnapper";
import { createSmoothMarker } from "./smoothMarker";
import type { SmoothMarker } from "./smoothMarker";
import { useDriverLocationStream } from "./useDriverLocationStream";
import type { LocationPoint } from "./useDriverLocationStream";

const OSM_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
/** Snap the trail every this many new points, over this many recent points. */
const SNAP_EVERY = 5;
const SNAP_WINDOW = 12;

function pin(label: string, color: string) {
  return L.divIcon({
    className: "",
    html: `<div aria-label="${label}" style="width:16px;height:16px;border-radius:9999px;background:${color};border:3px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

const PICKUP_ICON = pin("Pickup", "#2563eb");
const DESTINATION_ICON = pin("Destination", "#dc2626");
const CAR_ICON = L.divIcon({
  className: "",
  html: '<div class="rn-car" style="font-size:22px;line-height:22px;transition:opacity .3s">&#x1F697;</div>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

interface TripMapProps {
  pickup: LatLng;
  destination: LatLng;
  /** When set, the driver's position is streamed while the trip is being tracked. */
  trip?: TripResponse | null;
  /** The stream ended (trip-ended or refused): refetch the trip. */
  onStreamEnded?: (() => void) | undefined;
  className?: string;
}

export function TripMap({ pickup, destination, trip = null, onStreamEnded, className }: TripMapProps) {
  const center: [number, number] = [(pickup.lat + destination.lat) / 2, (pickup.lng + destination.lng) / 2];
  return (
    <div className={className ?? "h-64 overflow-hidden rounded-2xl border border-border"} data-testid="trip-map">
      <MapContainer center={center} zoom={13} scrollWheelZoom={false} style={{ height: "100%", width: "100%" }}>
        <TileLayer url={OSM_URL} attribution={OSM_ATTRIBUTION} />
        <Marker position={[pickup.lat, pickup.lng]} icon={PICKUP_ICON} title="Pickup" />
        <Marker position={[destination.lat, destination.lng]} icon={DESTINATION_ICON} title="Destination" />
        <FitBounds pickup={pickup} destination={destination} />
        {trip ? <DriverCar trip={trip} onStreamEnded={onStreamEnded} /> : null}
      </MapContainer>
    </div>
  );
}

function FitBounds({ pickup, destination }: { pickup: LatLng; destination: LatLng }) {
  const map = useMap();
  useEffect(() => {
    map.fitBounds(
      L.latLngBounds([pickup.lat, pickup.lng], [destination.lat, destination.lng]),
      { padding: [32, 32] },
    );
  }, [map, pickup.lat, pickup.lng, destination.lat, destination.lng]);
  return null;
}

function DriverCar({ trip, onStreamEnded }: { trip: TripResponse; onStreamEnded?: (() => void) | undefined }) {
  const map = useMap();
  const smooth = useRef<SmoothMarker | null>(null);
  const raw = useRef<LatLng[]>([]);
  const [trail, setTrail] = useState<LatLng[]>([]);
  const driverClient = useMemo(() => resolveDriverClient(appConfig), []);
  const snapper = useMemo(() => createRoadSnapper(appConfig.osrmUrl), []);

  useEffect(() => {
    const car = L.marker(map.getCenter(), { icon: CAR_ICON, title: "Driver", keyboard: false });
    let added = false;
    smooth.current = createSmoothMarker({
      setPosition(lat, lng, heading, stale) {
        if (!added) {
          car.addTo(map);
          added = true;
        }
        car.setLatLng([lat, lng]);
        const el = car.getElement()?.querySelector<HTMLElement>(".rn-car");
        if (el) {
          // The emoji faces left (west); rotate so it points along the heading.
          el.style.transform = `rotate(${heading - 270}deg)`;
          el.style.opacity = stale ? "0.4" : "1";
          el.title = stale ? "Driver position is out of date" : "Driver";
        }
      },
      isWellInView(lat, lng) {
        return map.getBounds().pad(-0.2).contains([lat, lng]);
      },
      panTo(lat, lng) {
        map.panTo([lat, lng], { animate: true });
      },
    });
    return () => {
      smooth.current?.stop();
      smooth.current = null;
      car.remove();
    };
  }, [map]);

  useDriverLocationStream(trip, {
    streamUrl: (tripId, passengerId) =>
      resolveUrl(
        `/live/trips/${encodeURIComponent(tripId)}/location?userId=${encodeURIComponent(passengerId)}`,
        appConfig,
      ),
    getSnapshot: (driverId) => driverClient.getLiveState(driverId),
    onPoint: (point: LocationPoint) => {
      smooth.current?.push(point);
      raw.current = [...raw.current, { lat: point.lat, lng: point.lng }].slice(-SNAP_WINDOW);
      if (raw.current.length >= 2 && raw.current.length % SNAP_EVERY === 0) {
        const window = raw.current;
        void snapper.snapTrace(window).then(setTrail);
      }
    },
    onEnded: onStreamEnded,
  });

  return trail.length >= 2 && appConfig.osrmUrl ? (
    <Polyline positions={trail.map((p) => [p.lat, p.lng] as [number, number])} pathOptions={{ weight: 4, opacity: 0.6 }} />
  ) : null;
}
