/**
 * AddressInput — combobox for entering a pickup or destination address (Req 5).
 *
 * Text edits are debounced and sent to the Geocoder; the rider picks a suggestion to
 * bind a Place. Editing text after a selection clears the bound Place (5.10).
 */
import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { LocateFixed } from "lucide-react";
import type { Geocoder, Place } from "../../geocoding/contract";
import { useDebouncedGeocoder } from "../../geocoding/useDebouncedGeocoder";
import { Button, Field, Input, cn } from "../../shared/ui";

export interface AddressInputProps {
  id: string;
  label: string;
  /** The bound Place, or null when nothing is selected. */
  value: Place | null;
  /** Called with the selected Place, or null when the rider edits the text. */
  onChange: (place: Place | null) => void;
  /** Null means address search is not configured (5.11). */
  geocoder: Geocoder | null;
  placeholder?: string;
  /** Shows the "Use my current location" control (pickup only). */
  allowCurrentLocation?: boolean;
  disabled?: boolean;
}

const CURRENT_LOCATION_UNAVAILABLE = "Your current location is unavailable. Type an address instead.";

export function AddressInput({
  id,
  label,
  value,
  onChange,
  geocoder,
  placeholder,
  allowCurrentLocation = false,
  disabled = false,
}: AddressInputProps) {
  const listId = useId();
  const geo = useDebouncedGeocoder(geocoder);
  const [text, setText] = useState(value?.address ?? "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Reflect an externally bound Place (swap, current location) in the text field.
  useEffect(() => {
    if (value) setText(value.address);
  }, [value]);

  const optionId = (i: number) => `${listId}-opt-${i}`;
  const hasSuggestions = geo.status === "results" && geo.suggestions.length > 0;
  const message =
    geo.status === "not-configured"
      ? "Address search is not configured."
      : geo.status === "empty"
        ? "No matching address"
        : geo.status === "error"
          ? "Address search failed."
          : geo.status === "loading"
            ? "Searching…"
            : null;
  const expanded = open && (hasSuggestions || (message !== null && geo.status !== "idle"));

  const select = (place: Place) => {
    setText(place.address);
    setOpen(false);
    setActive(-1);
    setLocationError(null);
    geo.reset();
    onChange(place);
  };

  const onText = (next: string) => {
    setText(next);
    setActive(-1);
    setLocationError(null);
    if (value) onChange(null);
    setOpen(true);
    geo.search(next);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      if (!hasSuggestions) return;
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % geo.suggestions.length);
    } else if (e.key === "ArrowUp") {
      if (!hasSuggestions) return;
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i <= 0 ? geo.suggestions.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      const place = open && active >= 0 ? geo.suggestions[active] : undefined;
      if (place) {
        e.preventDefault();
        select(place);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
        setActive(-1);
      }
    }
  };

  const useCurrentLocation = () => {
    setLocationError(null);
    if (!geocoder || typeof navigator === "undefined" || !navigator.geolocation) {
      setLocationError(CURRENT_LOCATION_UNAVAILABLE);
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        geocoder
          .reverse(pos.coords.latitude, pos.coords.longitude, new AbortController().signal)
          .then((place) => {
            if (!mounted.current) return;
            setLocating(false);
            if (place) select(place);
            else setLocationError(CURRENT_LOCATION_UNAVAILABLE);
          })
          .catch(() => {
            if (!mounted.current) return;
            setLocating(false);
            setLocationError(CURRENT_LOCATION_UNAVAILABLE);
          });
      },
      () => {
        if (!mounted.current) return;
        setLocating(false);
        setLocationError(CURRENT_LOCATION_UNAVAILABLE);
      },
    );
  };

  return (
    <Field htmlFor={id} label={label}>
      <div className="relative">
        <Input
          id={id}
          role="combobox"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
          autoComplete="off"
          value={text}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => onText(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => {
            if (hasSuggestions) setOpen(true);
          }}
          onBlur={() => setOpen(false)}
        />
        <ul
          id={listId}
          role="listbox"
          aria-label={`${label} suggestions`}
          hidden={!(expanded && hasSuggestions)}
          className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl bg-surface-raised shadow-lg"
        >
          {geo.suggestions.map((place, i) => (
            <li
              key={`${place.lat},${place.lng},${i}`}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              // mousedown fires before the input blur, so the selection is not lost.
              onMouseDown={(e) => {
                e.preventDefault();
                select(place);
              }}
              className={cn(
                "flex min-h-11 cursor-pointer items-center px-4 py-2 text-sm text-content",
                i === active && "bg-accent/10",
              )}
            >
              {place.address}
            </li>
          ))}
        </ul>
      </div>
      {message && geo.status !== "idle" && !hasSuggestions ? (
        <div className="flex items-center gap-2 text-sm text-content-muted" role="status">
          <span>{message}</span>
          {geo.status === "error" ? (
            <Button variant="secondary" size="sm" touch onClick={geo.retry}>
              Retry
            </Button>
          ) : null}
        </div>
      ) : null}
      {allowCurrentLocation ? (
        <Button
          variant="ghost"
          size="md"
          touch
          leftIcon={<LocateFixed className="h-4 w-4" />}
          loading={locating}
          disabled={disabled || !geocoder}
          onClick={useCurrentLocation}
          className="self-start"
        >
          Use my current location
        </Button>
      ) : null}
      {locationError ? (
        <span role="alert" className="text-sm text-danger">
          {locationError}
        </span>
      ) : null}
    </Field>
  );
}
