import { NodeEnvironment, validateEnv } from './env.validation';

const DATABASE_URL = 'postgresql://stockpro:stockpro@localhost:5433/stockpro?schema=public';
const JWT_ACCESS_SECRET = 'access-secret-that-is-long-enough-abcdef';
const JWT_REFRESH_SECRET = 'refresh-secret-that-is-long-enough-abcde';
const PLATFORM_ADMIN_JWT_SECRET = 'platform-admin-secret-that-is-long-enough';

/** The minimum a valid environment must supply; everything else has a default. */
const REQUIRED = { DATABASE_URL, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, PLATFORM_ADMIN_JWT_SECRET };

describe('validateEnv', () => {
  it('applies defaults when only the required values are provided', () => {
    const env = validateEnv({ ...REQUIRED });

    expect(env.DATABASE_URL).toBe(DATABASE_URL);
    expect(env.NODE_ENV).toBe(NodeEnvironment.Development);
    expect(env.API_PORT).toBe(4000);
    expect(env.WEB_URL).toBe('http://localhost:3001');
    expect(env.THROTTLE_TTL).toBe(60);
    expect(env.THROTTLE_LIMIT).toBe(100);
    expect(env.JWT_ACCESS_EXPIRES_IN).toBe('15m');
    expect(env.JWT_REFRESH_EXPIRES_IN).toBe('7d');
    expect(env.SWAGGER_ENABLED).toBeUndefined();
  });

  it('coerces numeric strings, because process.env only ever holds strings', () => {
    const env = validateEnv({ ...REQUIRED, API_PORT: '8080', THROTTLE_TTL: '30', THROTTLE_LIMIT: '5' });

    expect(env.API_PORT).toBe(8080);
    expect(env.THROTTLE_TTL).toBe(30);
    expect(env.THROTTLE_LIMIT).toBe(5);
  });

  it('accepts a comma-separated origin list', () => {
    const env = validateEnv({ ...REQUIRED, WEB_URL: 'http://localhost:3001,https://app.stockpro.test' });

    expect(env.WEB_URL).toBe('http://localhost:3001,https://app.stockpro.test');
  });

  it.each([
    ['an unknown NODE_ENV', { NODE_ENV: 'staging' }, 'NODE_ENV'],
    ['a non-numeric port', { API_PORT: 'not-a-port' }, 'API_PORT'],
    ['a port above the valid range', { API_PORT: '70000' }, 'API_PORT'],
    ['a port below the valid range', { API_PORT: '0' }, 'API_PORT'],
    ['an origin without a scheme', { WEB_URL: 'localhost:3001' }, 'WEB_URL'],
    ['an origin with a trailing slash', { WEB_URL: 'http://localhost:3001/' }, 'WEB_URL'],
    ['a zero throttle window', { THROTTLE_TTL: '0' }, 'THROTTLE_TTL'],
    ['a non-boolean SWAGGER_ENABLED', { SWAGGER_ENABLED: 'yes' }, 'SWAGGER_ENABLED'],
    ['a malformed access token lifetime', { JWT_ACCESS_EXPIRES_IN: '15 minutes' }, 'JWT_ACCESS_EXPIRES_IN'],
    ['a lifetime with an unknown unit', { JWT_REFRESH_EXPIRES_IN: '7w' }, 'JWT_REFRESH_EXPIRES_IN'],
  ])('rejects %s', (_label, overrides: Record<string, unknown>, property: string) => {
    expect(() => validateEnv({ ...REQUIRED, ...overrides })).toThrow(new RegExp(property));
  });

  describe('JWT secrets', () => {
    it.each([
      ['missing', {}],
      ['too short', { JWT_ACCESS_SECRET: 'short', JWT_REFRESH_SECRET: 'short-too' }],
      ['exactly one character short', { JWT_ACCESS_SECRET: 'a'.repeat(31), JWT_REFRESH_SECRET: 'b'.repeat(31) }],
    ])('refuses to start when the secrets are %s', (_label, overrides: Record<string, unknown>) => {
      expect(() => validateEnv({ DATABASE_URL, ...overrides })).toThrow(/JWT_(ACCESS|REFRESH)_SECRET/);
    });

    it('accepts secrets of exactly the minimum length', () => {
      expect(() =>
        validateEnv({ DATABASE_URL, JWT_ACCESS_SECRET: 'a'.repeat(32), JWT_REFRESH_SECRET: 'b'.repeat(32), PLATFORM_ADMIN_JWT_SECRET: 'c'.repeat(32) }),
      ).not.toThrow();
    });

    it('refuses to reuse one secret for both token kinds', () => {
      const shared = 'the-same-secret-used-for-both-kinds-oops';

      expect(() => validateEnv({ DATABASE_URL, JWT_ACCESS_SECRET: shared, JWT_REFRESH_SECRET: shared, PLATFORM_ADMIN_JWT_SECRET })).toThrow(
        /JWT_REFRESH_SECRET must be different from JWT_ACCESS_SECRET/,
      );
    });
  });

  describe('platform-admin JWT secret', () => {
    it.each([
      ['missing', {}],
      ['too short', { PLATFORM_ADMIN_JWT_SECRET: 'short' }],
    ])('refuses to start when the secret is %s', (_label, overrides: Record<string, unknown>) => {
      expect(() => validateEnv({ DATABASE_URL, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, ...overrides })).toThrow(/PLATFORM_ADMIN_JWT_SECRET/);
    });

    it.each([
      ['the access secret', JWT_ACCESS_SECRET],
      ['the refresh secret', JWT_REFRESH_SECRET],
    ])('refuses to reuse %s', (_label, shared: string) => {
      expect(() => validateEnv({ DATABASE_URL, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, PLATFORM_ADMIN_JWT_SECRET: shared })).toThrow(
        /PLATFORM_ADMIN_JWT_SECRET must differ from JWT_ACCESS_SECRET and JWT_REFRESH_SECRET/,
      );
    });
  });

  it.each([
    ['missing entirely', {}],
    ['empty', { DATABASE_URL: '' }],
    ['not a URL', { DATABASE_URL: 'localhost' }],
    ['the wrong protocol', { DATABASE_URL: 'mysql://user:pass@localhost:3306/db' }],
  ])('refuses to start when DATABASE_URL is %s', (_label, overrides: Record<string, unknown>) => {
    expect(() => validateEnv({ JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, ...overrides })).toThrow(/DATABASE_URL/);
  });

  it('ignores unrelated environment variables', () => {
    expect(() => validateEnv({ ...REQUIRED, PATH: '/usr/bin', HOME: '/home/dev' })).not.toThrow();
  });
});
