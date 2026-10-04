// Small shared guards for defensive parsing of recorded provider payloads.
// Providers throw explicit errors on shape violations (provider-framework
// spec: parsing failures must be explicit, never silent undefined access).

/** Narrows an unknown value to a plain-object record, or null. */
export function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

/**
 * Parses a numeric field that vendors serialize as either a JSON number or a
 * decimal string (BSS amounts, OpenAI amount.value). Returns null when the
 * field is missing or not finite — callers turn that into an explicit error.
 */
export function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
