/**
 * Turns a display name into a URL-safe slug.
 *
 * Diacritics are folded rather than stripped, so `Café` becomes `cafe` instead
 * of `caf`. Everything that is not a letter or digit collapses to a single
 * hyphen, and leading and trailing hyphens are trimmed.
 *
 * Returns an empty string when the name contains nothing sluggable (for
 * example a name written entirely in a non-Latin script). Callers treat that
 * as "no slug could be derived" and ask for one explicitly, rather than
 * silently storing an empty unique key.
 */
export function slugify(value: string): string {
  return (
    value
      .normalize('NFKD')
      // Combining diacritical marks, left behind by NFKD decomposition.
      .replace(/[\u0300-\u036F]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+/, '')
      .replace(/-+$/, '')
  );
}
