/**
 * Builds the `where` fragment for a free-text search across several columns.
 *
 * The search is split on whitespace and **every** term must match somewhere.
 * OR-ing the whole phrase would find nobody for `Leila Farouk`, whose name is
 * split across two columns, while matching any single term would make a
 * two-word search broader than a one-word search.
 *
 * @param fields Columns to search, supplied by the calling module and checked
 * against the where type so a typo is a compile error. Never taken from user
 * input: a caller-chosen column would let anyone probe data they are not
 * allowed to read.
 */
export function searchAcross<Where>(search: string | undefined, fields: readonly Extract<keyof Where, string>[]): { AND: Where[] } | undefined {
  const terms = search === undefined ? [] : search.split(/\s+/).filter((term) => term !== '');

  if (terms.length === 0 || fields.length === 0) {
    return undefined;
  }

  return {
    AND: terms.map(
      (term) =>
        // Computed keys produce an index signature, which no Prisma where type
        // accepts; the field list is a module-owned constant, so asserting the
        // shape here is safe and keeps the cast in one place.
        ({
          OR: fields.map((field) => ({ [field]: { contains: term, mode: 'insensitive' } })),
        }) as Where,
    ),
  };
}
