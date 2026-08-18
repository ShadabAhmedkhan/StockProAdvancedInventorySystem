import { Paginated, pageWindow, paginate } from './paginated';

describe('pageWindow', () => {
  it.each([
    [1, 20, 0, 20],
    [2, 20, 20, 20],
    [5, 10, 40, 10],
    [1, 1, 0, 1],
  ])('page %d of %d rows skips %d and takes %d', (page: number, limit: number, skip: number, take: number) => {
    expect(pageWindow(page, limit)).toEqual({ skip, take });
  });
});

describe('paginate', () => {
  it('wraps items with their page metadata', () => {
    const result = paginate(['a', 'b'], 100, 1, 20);

    expect(result).toBeInstanceOf(Paginated);
    expect(result.items).toEqual(['a', 'b']);
    expect(result.pagination).toEqual({ page: 1, limit: 20, total: 100, totalPages: 5 });
  });

  it('rounds a partial last page up', () => {
    expect(paginate([], 101, 1, 20).pagination.totalPages).toBe(6);
  });

  it('reports zero pages for an empty result rather than one empty page', () => {
    expect(paginate([], 0, 1, 20).pagination).toEqual({ page: 1, limit: 20, total: 0, totalPages: 0 });
  });
});
