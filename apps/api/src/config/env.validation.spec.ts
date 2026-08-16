import { NodeEnvironment, validateEnv } from './env.validation';

const DATABASE_URL = 'postgresql://stockpro:stockpro@localhost:5433/stockpro?schema=public';

/** The minimum a valid environment must supply; everything else has a default. */
const REQUIRED = { DATABASE_URL };

describe('validateEnv', () => {
  it('applies defaults when only the required values are provided', () => {
    const env = validateEnv({ ...REQUIRED });

    expect(env.DATABASE_URL).toBe(DATABASE_URL);
    expect(env.NODE_ENV).toBe(NodeEnvironment.Development);
    expect(env.API_PORT).toBe(4000);
    expect(env.WEB_URL).toBe('http://localhost:3000');
    expect(env.THROTTLE_TTL).toBe(60);
    expect(env.THROTTLE_LIMIT).toBe(100);
    expect(env.SWAGGER_ENABLED).toBeUndefined();
  });

  it('coerces numeric strings, because process.env only ever holds strings', () => {
    const env = validateEnv({ ...REQUIRED, API_PORT: '8080', THROTTLE_TTL: '30', THROTTLE_LIMIT: '5' });

    expect(env.API_PORT).toBe(8080);
    expect(env.THROTTLE_TTL).toBe(30);
    expect(env.THROTTLE_LIMIT).toBe(5);
  });

  it('accepts a comma-separated origin list', () => {
    const env = validateEnv({ ...REQUIRED, WEB_URL: 'http://localhost:3000,https://app.stockpro.test' });

    expect(env.WEB_URL).toBe('http://localhost:3000,https://app.stockpro.test');
  });

  it.each([
    ['an unknown NODE_ENV', { NODE_ENV: 'staging' }, 'NODE_ENV'],
    ['a non-numeric port', { API_PORT: 'not-a-port' }, 'API_PORT'],
    ['a port above the valid range', { API_PORT: '70000' }, 'API_PORT'],
    ['a port below the valid range', { API_PORT: '0' }, 'API_PORT'],
    ['an origin without a scheme', { WEB_URL: 'localhost:3000' }, 'WEB_URL'],
    ['an origin with a trailing slash', { WEB_URL: 'http://localhost:3000/' }, 'WEB_URL'],
    ['a zero throttle window', { THROTTLE_TTL: '0' }, 'THROTTLE_TTL'],
    ['a non-boolean SWAGGER_ENABLED', { SWAGGER_ENABLED: 'yes' }, 'SWAGGER_ENABLED'],
  ])('rejects %s', (_label, overrides: Record<string, unknown>, property: string) => {
    expect(() => validateEnv({ ...REQUIRED, ...overrides })).toThrow(new RegExp(property));
  });

  it.each([
    ['missing entirely', {}],
    ['empty', { DATABASE_URL: '' }],
    ['not a URL', { DATABASE_URL: 'localhost' }],
    ['the wrong protocol', { DATABASE_URL: 'mysql://user:pass@localhost:3306/db' }],
  ])('refuses to start when DATABASE_URL is %s', (_label, overrides: Record<string, unknown>) => {
    expect(() => validateEnv({ ...overrides })).toThrow(/DATABASE_URL/);
  });

  it('ignores unrelated environment variables', () => {
    expect(() => validateEnv({ ...REQUIRED, PATH: '/usr/bin', HOME: '/home/dev' })).not.toThrow();
  });
});
