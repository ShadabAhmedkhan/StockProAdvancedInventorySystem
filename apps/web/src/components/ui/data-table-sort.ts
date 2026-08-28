export interface SortState {
  sortBy: string;
  sortOrder: 'asc' | 'desc';
}

/**
 * Toggles through desc -> asc -> desc for the clicked column; switching
 * columns always starts at desc (freshest/highest-first is the useful
 * default for every sortable field this app has - dates, prices, quantities).
 */
export function nextSortState(current: SortState, columnKey: string): SortState {
  if (current.sortBy !== columnKey) {
    return { sortBy: columnKey, sortOrder: 'desc' };
  }
  return { sortBy: columnKey, sortOrder: current.sortOrder === 'desc' ? 'asc' : 'desc' };
}
