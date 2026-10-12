/**
 * Queries are declared one root field at a time, and documents are assembled
 * from those fields.
 *
 * The reason is drift. A venue's data is fetched two ways: batched into one
 * request per tick, and individually when a hook has to fetch for itself. Those
 * two must return the *same rows*, or the batched write lands a different shape
 * in the cache than the hook's own fetch would. Sharing only the field list —
 * which is what the `*_FIELDS` constants used to do — protects the selection but
 * not the `where:` clause, and the filter is the half that decides which rows
 * come back. Two had already drifted when this was introduced.
 *
 * So a `Slice` owns the whole root field: alias, arguments and selection. The
 * standalone document and the batched document are both built from it, and there
 * is one place to look to see what a given cache entry is fed by.
 */

/**
 * How long a slice's value stays true, which is what decides its cadence.
 *
 * This is a caching policy, not a request boundary: several groups due on the
 * same tick go out as one document. See `QUERY_GROUPS.md`.
 */
export type QueryGroup =
  /** Governance-mutable. Fetched once and kept until reload. */
  | "constants"
  /** Scoped to the connected wallet. Dropped entirely when there isn't one. */
  | "account"
  /** Scoped to the market on screen. Only ticks for the venue being looked at. */
  | "market"
  /** Paginated tables and modals. Never on a tick; fetched when asked for. */
  | "history";

export type Slice = {
  /**
   * The response key, and the name used to pick slices out of a batch. Matches
   * the alias in `field` when there is one.
   */
  readonly alias: string;
  readonly group: QueryGroup;
  /** Variable definitions this field needs, e.g. `{ orderFirst: "Int!" }`. */
  readonly vars: Readonly<Record<string, string>>;
  /** The root field itself: alias, arguments and selection set. */
  readonly field: string;
  /**
   * The react-query key this slice feeds, for documentation. Written as it
   * appears in the fan-out, with `…` where a runtime value goes.
   */
  readonly cacheKey: string;
};

export const META_FIELDS = `
  _meta {
    block {
      number
      timestamp
    }
  }
`;

/**
 * Merge the variable definitions of several slices.
 *
 * Throws on a name used with two different types. That can only happen by
 * mistake, and at module scope it fails the build rather than a request.
 */
const mergeVars = (slices: readonly Slice[]): string[] => {
  const merged = new Map<string, string>();
  for (const slice of slices) {
    for (const [name, type] of Object.entries(slice.vars)) {
      const existing = merged.get(name);
      if (existing && existing !== type) {
        throw new Error(
          `Variable $${name} is declared as both ${existing} and ${type}; ` +
            `slices sharing a name must share a type (in slice "${slice.alias}")`,
        );
      }
      merged.set(name, type);
    }
  }
  return [...merged].map(([name, type]) => `$${name}: ${type}`);
};

/**
 * Memoised because the drivers rebuild their document on every tick from
 * whichever groups are due, and there are only a handful of distinct
 * combinations.
 */
const documents = new Map<string, string>();

/**
 * Render slices as one executable document.
 *
 * `_meta` is always selected: every response carries the block it was read at,
 * which is what the post-transaction wait and the fan-out's staleness guard
 * compare against.
 */
export const buildDocument = (name: string, slices: readonly Slice[]): string => {
  if (slices.length === 0) {
    throw new Error(`Cannot build document "${name}" from no slices`);
  }

  const memoKey = `${name}(${slices.map((s) => s.alias).join(",")})`;
  const memoised = documents.get(memoKey);
  if (memoised) return memoised;

  const vars = mergeVars(slices);
  const header = vars.length > 0 ? `query ${name}(\n  ${vars.join("\n  ")}\n)` : `query ${name}`;

  const document = `${header} {${META_FIELDS}${slices.map((s) => s.field).join("\n")}
}
`;
  documents.set(memoKey, document);
  return document;
};

/** Identity, for the type inference and the readability of the slice files. */
export const defineSlices = <T extends Record<string, Slice>>(slices: T): T => slices;
