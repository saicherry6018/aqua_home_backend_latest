import { GeoLocation, GeoPolygon } from '../types';

/**
 * Generate a unique ID for a specific entity
 * @param prefix The prefix for the ID, e.g., 'user', 'product', etc.
 * @returns A unique ID string
 */
export async function  generateId(prefix: string): Promise<string> {
  const id = Array.from(crypto.getRandomValues(new Uint8Array(10)))
    .map(b => b.toString(36).padStart(2, '0'))
    .join('')
    .slice(0, 10)
  return `${prefix}_${id}`;
}

/**
 * Check if a point is inside a polygon
 * @param point The point coordinates
 * @param polygon The polygon coordinates (array of lat/lng objects or GeoJSON)
 * @returns true if the point is inside the polygon, false otherwise
 */
export function isPointInPolygon(point: GeoLocation, polygon: GeoPolygon | Array<{ latitude: number, longitude: number }>): boolean {
  let coordinates: number[][];

  // Handle different polygon formats
  if (Array.isArray(polygon)) {
    // Handle array of {latitude, longitude} objects
    coordinates = polygon.map(p => [p.longitude, p.latitude]);
  } else if (polygon.coordinates && polygon.coordinates[0]) {
    // Handle GeoJSON format
    coordinates = polygon.coordinates[0];
  } else {
    return false;
  }

  // Ensure polygon is closed (first point equals last point)
  if (coordinates.length > 0) {
    const firstPoint = coordinates[0];
    const lastPoint = coordinates[coordinates.length - 1];
    if (firstPoint[0] !== lastPoint[0] || firstPoint[1] !== lastPoint[1]) {
      coordinates.push([firstPoint[0], firstPoint[1]]);
    }
  }

  const x = point.longitude;
  const y = point.latitude;

  let inside = false;
  for (let i = 0, j = coordinates.length - 1; i < coordinates.length; j = i++) {
    const xi = coordinates[i][0];
    const yi = coordinates[i][1];
    const xj = coordinates[j][0];
    const yj = coordinates[j][1];

    const intersect = ((yi > y) !== (yj > y))
      && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }

  return inside;
}

/**
 * Find which franchise area a point belongs to
 * @param point The point coordinates
 * @param franchiseAreas Array of franchise areas with their polygons
 * @returns The ID of the franchise area the point belongs to, or undefined if none found
 */
export function findFranchiseAreaForLocation(
  point: GeoLocation,
  franchiseAreas: Array<{ id: string; geoPolygon: any }>
): string | undefined {
  for (const area of franchiseAreas) {
    let polygon;

    // Parse the geoPolygon if it's a string
    if (typeof area.geoPolygon === 'string') {
      try {
        polygon = JSON.parse(area.geoPolygon);
      } catch (e) {
        continue;
      }
    } else {
      polygon = area.geoPolygon;
    }

    if (isPointInPolygon(point, polygon)) {
      return area.id;
    }
  }
  return undefined;
}

/**
 * Calculate distance between two points using Haversine formula
 * @param point1 The first point coordinates
 * @param point2 The second point coordinates
 * @returns Distance in kilometers
 */
export function calculateDistance(point1: GeoLocation, point2: GeoLocation): number {
  const R = 6371; // Earth's radius in km
  const dLat = degToRad(point2.latitude - point1.latitude);
  const dLon = degToRad(point2.longitude - point1.longitude);

  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(degToRad(point1.latitude)) * Math.cos(degToRad(point2.latitude)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Convert degrees to radians
 * @param degrees Angle in degrees
 * @returns Angle in radians
 */
function degToRad(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Parse JSON string and handle errors
 * @param jsonString The JSON string to parse
 * @param defaultValue Default value to return on error
 * @returns Parsed object or default value on error
 */
export function parseJsonSafe<T>(jsonString: string | null | undefined, defaultValue: T): T {
  if (!jsonString) return defaultValue;

  try {
    return JSON.parse(jsonString) as T;
  } catch (error) {
    return defaultValue;
  }
}

/**
 * Format a date to YYYY-MM-DD
 * @param date Date to format
 * @returns Formatted date string
 */
export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Normalize polygon coordinates to ensure proper closure
 * @param coordinates Array of coordinate pairs
 * @returns Normalized coordinates with proper closure
 */
export function normalizePolygonCoordinates(coordinates: Array<{ latitude: number, longitude: number }>): Array<{ latitude: number, longitude: number }> {
  if (coordinates.length === 0) return coordinates;

  const normalized = [...coordinates];
  const firstPoint = normalized[0];
  const lastPoint = normalized[normalized.length - 1];

  // Ensure polygon is closed
  if (firstPoint.latitude !== lastPoint.latitude || firstPoint.longitude !== lastPoint.longitude) {
    normalized.push({ latitude: firstPoint.latitude, longitude: firstPoint.longitude });
  }

  return normalized;
}