/**
 * TripMap — Leaflet + OpenStreetMap tiles with the pickup, the destination and, while
 * the trip is being tracked, the driver's car gliding along (docs/REALTIME.md).
 *
 * The car follows the raw positions through {@link createSmoothMarker}. When
 * `VITE_OSRM_URL` is set, the recent trail is also snapped to roads and drawn as a
 * line; snapped points are display-only.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { MapContainer, Marker, Polyline, TileLayer, ZoomControl, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { appConfig } from "../config/appConfig";
import { resolveDriverClient } from "../domain/driver";
import type { TripResponse } from "../domain/trip";
import { resolveUrl } from "../http/resolveUrl";
import { createRoadSnapper } from "./roadSnapper";
import type { LatLng } from "./roadSnapper";
import { createGlideMarker } from "./smoothMarker";
import type { SmoothMarker } from "./smoothMarker";
import { useDriverLocationStream } from "./useDriverLocationStream";
import type { LocationPoint, StreamState } from "./useDriverLocationStream";

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
  /** Reports the live-stream connection state. */
  onStreamState?: ((state: StreamState) => void) | undefined;
  className?: string;
  /** Fill the positioned parent (`absolute inset-0`) with no rounding, for use behind a bottom sheet. */
  fullBleed?: boolean;
  /** Pixels at the bottom of the map covered by a sheet; `fitBounds` keeps the route above it. */
  bottomInset?: number;
  children?: ReactNode;
}

export const OSM_TILE_URL = OSM_URL;
export const OSM_TILE_ATTRIBUTION = OSM_ATTRIBUTION;
export { PICKUP_ICON, DESTINATION_ICON };

export function TripMap({
  pickup,
  destination,
  trip = null,
  onStreamEnded,
  onStreamState,
  className,
  fullBleed = false,
  bottomInset = 0,
  children,
}: TripMapProps) {
  const center: [number, number] = [(pickup.lat + destination.lat) / 2, (pickup.lng + destination.lng) / 2];
  const wrapperClass = fullBleed
    ? (className ?? "absolute inset-0 isolate")
    : (className ?? "h-64 overflow-hidden rounded-2xl isolate");
  return (
    <div className={wrapperClass} data-testid="trip-map">
      <MapContainer
        center={center}
        zoom={13}
        scrollWheelZoom={false}
        zoomControl={!fullBleed}
        style={{ height: "100%", width: "100%" }}
      >
        {fullBleed ? <ZoomControl position="topright" /> : null}
        <TileLayer url={OSM_URL} attribution={OSM_ATTRIBUTION} />
        <Marker position={[pickup.lat, pickup.lng]} icon={PICKUP_ICON} title="Pickup" />
        <Marker position={[destination.lat, destination.lng]} icon={DESTINATION_ICON} title="Destination" />
        <FitBounds pickup={pickup} destination={destination} bottomInset={bottomInset} />
        {trip ? <DriverCar trip={trip} onStreamEnded={onStreamEnded} onStreamState={onStreamState} /> : null}
        {children}
      </MapContainer>
    </div>
  );
}

/** Fit both points, padding the bottom by the height of an overlaying sheet. */
export function FitBounds({
  pickup,
  destination,
  bottomInset = 0,
}: {
  pickup: LatLng;
  destination: LatLng;
  bottomInset?: number;
}) {
  const map = useMap();
  useEffect(() => {
    map.fitBounds(L.latLngBounds([pickup.lat, pickup.lng], [destination.lat, destination.lng]), {
      paddingTopLeft: [32, 32],
      paddingBottomRight: [32, 32 + bottomInset],
    });
  }, [map, pickup.lat, pickup.lng, destination.lat, destination.lng, bottomInset]);
  return null;
}

export function DriverCar({
  trip,
  onStreamEnded,
  onStreamState,
}: {
  trip: TripResponse;
  onStreamEnded?: (() => void) | undefined;
  onStreamState?: ((state: StreamState) => void) | undefined;
}) {
  const map = useMap();
  const smooth = useRef<SmoothMarker | null>(null);
  const raw = useRef<LatLng[]>([]);
  const [trail, setTrail] = useState<LatLng[]>([]);
  const driverClient = useMemo(() => resolveDriverClient(appConfig), []);
  const snapper = useMemo(() => createRoadSnapper(appConfig.osrmUrl), []);

  useEffect(() => {
    const car = L.marker(map.getCenter(), { icon: CAR_ICON, title: "Driver", keyboard: false });
    let added = false;
    smooth.current = createGlideMarker({
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

  const streamState = useDriverLocationStream(trip, {
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
  useEffect(() => {
    onStreamState?.(streamState);
  }, [streamState, onStreamState]);

  return trail.length >= 2 && appConfig.osrmUrl ? (
    <Polyline positions={trail.map((p) => [p.lat, p.lng] as [number, number])} pathOptions={{ weight: 4, opacity: 0.6 }} />
  ) : null;
}
