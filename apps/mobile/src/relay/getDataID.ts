import { Predicate } from "effect";
import type { EnvironmentConfig } from "relay-runtime";

type GetDataID = NonNullable<EnvironmentConfig["getDataID"]>;

/** Types without an `id` whose records are still identified by one of their fields. */
const IDENTIFYING_FIELDS: ReadonlyMap<string, string> = new Map([
  ["Campus", "slug"],
  ["FeaturedEvents", "slug"],
  ["LeadPastor", "slug"],
  ["SavedVerse", "verseId"],
]);

export const getRelayDataID: GetDataID = (fieldValue, typeName) => {
  const id = fieldValue.id;
  if (Predicate.isString(id) || Predicate.isNumber(id)) {
    return String(id);
  }

  const field = IDENTIFYING_FIELDS.get(typeName);
  const key = field === undefined ? undefined : fieldValue[field];
  if (Predicate.isString(key) && key.length > 0) {
    return `${typeName}:${key}`;
  }

  return null;
};
