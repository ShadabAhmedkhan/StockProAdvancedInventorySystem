import { describe, expect, it } from 'vitest';
import { nextSortState } from './data-table-sort';

describe('nextSortState', () => {
  it('starts a newly clicked column at desc', () => {
    expect(nextSortState({ sortBy: 'name', sortOrder: 'asc' }, 'price')).toEqual({ sortBy: 'price', sortOrder: 'desc' });
  });

  it('toggles the same column from desc to asc', () => {
    expect(nextSortState({ sortBy: 'price', sortOrder: 'desc' }, 'price')).toEqual({ sortBy: 'price', sortOrder: 'asc' });
  });

  it('toggles the same column from asc back to desc', () => {
    expect(nextSortState({ sortBy: 'price', sortOrder: 'asc' }, 'price')).toEqual({ sortBy: 'price', sortOrder: 'desc' });
  });
});
