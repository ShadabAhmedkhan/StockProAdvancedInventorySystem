/**
 * Test-only helper for reading the arguments a jest mock was called with.
 *
 * `mock.calls` is typed `any[][]`, so reading it inline forces an unsafe member
 * access at every assertion. Narrowing it once here keeps the cast in a single
 * place and gives call sites a real type.
 *
 * Excluded from the production build by tsconfig.build.json.
 */
export function firstCallArg(mock: jest.Mock, index = 0): unknown {
  return callArg(mock, 0, index);
}

/**
 * The same, for the most recent call. Used where one delegate is written to
 * several times in a single operation and the assertion is about the last of
 * them.
 */
export function lastCallArg(mock: jest.Mock, index = 0): unknown {
  return callArg(mock, -1, index);
}

function callArg(mock: jest.Mock, call: number, index: number): unknown {
  const calls = mock.mock.calls as unknown[][];
  const argument = calls.at(call)?.[index];

  if (argument === undefined) {
    throw new Error(`Expected the mock to have been called with an argument at index ${String(index)}`);
  }

  return argument;
}
