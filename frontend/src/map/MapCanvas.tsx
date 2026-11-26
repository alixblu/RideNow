/**
 * MapCanvas — full-bleed map that fills its positioned parent (`absolute inset-0`),
 * meant to sit behind a BottomSheet. Before a route exists it shows the city centre;
 * once pickup and destination are set it fits them above the sheet.
 */
import { MapContainer, Marker, TileLayer, ZoomControl } from "react-leaflet";
import type { ReactNode } from "react";
import "leaflet/dist/leaflet.css";
import type { TripResponse } from "../domain/trip";
import type { LatLng } from "./roadSnapper";
import type { StreamState } from "./useDriverLocationStream";
import {
  DESTINATION_ICON,
  DriverCar,
  FitBounds,
  OSM_TILE_ATTRIBUTION,
  OSM_TILE_URL,
  PICKUP_ICON,
  TripMap,
} from "./TripMap";

/** Ho Chi Minh City centre, shown until a route is chosen. */
const DEFAULT_CENTER: [number, number] = [10.7769, 106.7009];

export interface MapCanvasProps {
  pickup?: LatLng | null;
  destination?: LatLng | null;
  /** When set, the driver's position is streamed while the trip is tracked. */
  trip?: TripResponse | null;
  onStreamEnded?: (() => void) | undefined;
  onStreamState?: ((state: StreamState) => void) | undefined;
  /** Height in pixels of the sheet overlaying the lower map. */
  sheetHeight?: number;
  className?: string;
  children?: ReactNode;
}

export function MapCanvas({
  pickup = null,
  destination = null,
  trip = null,
  onStreamEnded,
  onStreamState,
  sheetHeight = 0,
  className = "absolute inset-0 isolate",
  children,
}: MapCanvasProps) {
  if (pickup && destination) {
    return (
      <TripMap
        fullBleed
        pickup={pickup}
        destination={destination}
        trip={trip}
        onStreamEnded={onStreamEnded}
        onStreamState={onStreamState}
        bottomInset={sheetHeight}
        className={className}
      >
        {children}
      </TripMap>
    );
  }

  const only = pickup ?? destination;
  const center: [number, number] = only ? [only.lat, only.lng] : DEFAULT_CENTER;
  return (
    <div className={className} data-testid="trip-map">
      <MapContainer
        center={center}
        zoom={13}
        scrollWheelZoom={false}
        zoomControl={false}
        style={{ height: "100%", width: "100%" }}
      >
        <ZoomControl position="topright" />
        <TileLayer url={OSM_TILE_URL} attribution={OSM_TILE_ATTRIBUTION} />
        {pickup ? <Marker position={[pickup.lat, pickup.lng]} icon={PICKUP_ICON} title="Pickup" /> : null}
        {destination ? (
          <Marker position={[destination.lat, destination.lng]} icon={DESTINATION_ICON} title="Destination" />
        ) : null}
        {trip ? <DriverCar trip={trip} onStreamEnded={onStreamEnded} onStreamState={onStreamState} /> : null}
        {children}
      </MapContainer>
    </div>
  );
}

export { FitBounds };
