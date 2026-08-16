import { hash, verify, type Options } from '@node-rs/argon2';

/**
 * `Algorithm.Argon2id`. The package declares `Algorithm` as an ambient const
 * enum, which cannot be referenced under `isolatedModules`, so the value is
 * written out rather than left to the library default - the algorithm choice
 * is a security decision and should not silently follow a dependency.
 */
const ARGON2ID = 2;

/**
 * Argon2id parameters following the OWASP Password Storage Cheat Sheet
 * (19 MiB memory, 2 iterations, 1 lane). Raising `memoryCost` or `timeCost`
 * later is safe: a stored hash encodes the parameters it was created with, so
 * existing passwords keep verifying.
 */
const ARGON2_OPTIONS: Options = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

/** Hashes a plaintext password. The result embeds the salt and parameters. */
export function hashPassword(plainPassword: string): Promise<string> {
  return hash(plainPassword, ARGON2_OPTIONS);
}

/**
 * Verifies a password against a stored hash.
 *
 * A malformed or truncated hash resolves to `false` rather than throwing, so a
 * corrupt row cannot turn a failed login into a 500 that is distinguishable
 * from a wrong password.
 */
export async function verifyPassword(storedHash: string, plainPassword: string): Promise<boolean> {
  try {
    return await verify(storedHash, plainPassword, ARGON2_OPTIONS);
  } catch {
    return false;
  }
}
