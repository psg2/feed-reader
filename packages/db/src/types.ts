/**
 * Domain types used by JSONB columns in the schema.
 *
 * These types define the shapes stored in Postgres JSONB fields.
 * Keep them serialization-safe (no Date objects, no class instances).
 *
 * Usage:
 *   import type { MyJsonType } from "@feedreader/db/types";
 *
 * Add your JSONB column types here as you create them.
 */

// Example: if you add a `settings jsonb` column to a table, define the shape here:
//
// export interface UserSettings {
//   theme: "light" | "dark" | "system";
//   notifications: boolean;
//   locale: string;
// }
