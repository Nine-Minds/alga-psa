import { Platform } from "react-native";

// Free-text search in the platform maps app. A postal address geocodes far
// better than a location name, so callers pass the address when they have it.
export function buildMapsUrl(query: string, os: string = Platform.OS): string {
  const q = encodeURIComponent(query.trim());
  return os === "ios" ? `maps:0,0?q=${q}` : `geo:0,0?q=${q}`;
}

// Multi-line addresses (one part per line) become a single search string.
export function mapsQueryFromLines(address: string): string {
  return address
    .split("\n")
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");
}
