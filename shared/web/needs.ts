// Which needs a place serves, for the public directory.
//
// Reuses shared/rank.ts (the same rules find_resources and make_plan use:
// org_type defaults + offered programs' needs; consulates count for ID only).
// On top of that, approved community places may carry an optional `needs`
// array copied from the submission form.

import { placeNeeds } from "../rank.ts";
import type { Catalog } from "../rank.ts";
import { NEEDS } from "../schema.ts";
import type { Need, Place } from "../schema.ts";

export function directoryNeeds(cat: Catalog, place: Place & { needs?: unknown }): Need[] {
  const out = placeNeeds(cat, place);
  if (Array.isArray(place.needs)) {
    for (const n of place.needs) if ((NEEDS as readonly unknown[]).includes(n)) out.add(n as Need);
  }
  return [...out];
}
