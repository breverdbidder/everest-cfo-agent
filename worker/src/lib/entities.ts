// Entity catalog for the viz layer (issue #19764). Mirrors the 7 distinct entity_code values
// live in finance.accounts as of 2026-09-02. "all" is a synthetic aggregate that MUST exclude
// ariel_personal -- Personal is never part of "All business" (issue requirement).

export const ENTITY_CODES = [
  "everest_capital_brevard",
  "everest_capital",
  "biddeed",
  "zonewise",
  "winnerdata",
  "protection_partners",
  "ariel_personal",
] as const;

export type EntityCode = (typeof ENTITY_CODES)[number];

export const ENTITY_LABELS: Record<EntityCode, string> = {
  everest_capital_brevard: "Everest Capital of Brevard",
  everest_capital: "Everest Capital USA",
  biddeed: "BidDeed",
  zonewise: "ZoneWise",
  winnerdata: "Winner Data",
  protection_partners: "Protection Partners",
  ariel_personal: "Personal (Ariel)",
};

// "All business" scope -- every entity except ariel_personal.
export const BUSINESS_ENTITY_CODES: EntityCode[] = ENTITY_CODES.filter(
  (c) => c !== "ariel_personal",
);

export function isEntityCode(value: string | null): value is EntityCode {
  return !!value && (ENTITY_CODES as readonly string[]).includes(value);
}

/** Resolves an `?entity=` query param into the concrete entity_code list to filter by.
 * "all" / missing / unrecognized -> BUSINESS_ENTITY_CODES (never includes ariel_personal). */
export function resolveEntityScope(param: string | null): EntityCode[] {
  if (param && isEntityCode(param)) return [param];
  return BUSINESS_ENTITY_CODES;
}
