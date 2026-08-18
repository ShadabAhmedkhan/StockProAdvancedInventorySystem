import { searchAcross } from './search.util';

interface Contains {
  contains: string;
  mode: string;
}

interface FakeWhere {
  code?: Contains;
  name?: Contains;
  AND?: FakeWhere[];
  OR?: FakeWhere[];
}

const FIELDS = ['code', 'name'] as const;

describe('searchAcross', () => {
  it.each([[undefined], [''], ['   '], ['\t \n']])('returns undefined for %p so no clause is added', (search: string | undefined) => {
    expect(searchAcross<FakeWhere>(search, FIELDS)).toBeUndefined();
  });

  it('returns undefined when no fields are searchable', () => {
    expect(searchAcross<FakeWhere>('anything', [])).toBeUndefined();
  });

  it('ORs a single term across every field', () => {
    expect(searchAcross<FakeWhere>('acme', FIELDS)).toEqual({
      AND: [
        {
          OR: [{ code: { contains: 'acme', mode: 'insensitive' } }, { name: { contains: 'acme', mode: 'insensitive' } }],
        },
      ],
    });
  });

  it('ANDs the terms of a multi-word search, so every term must match somewhere', () => {
    const result = searchAcross<FakeWhere>('acme components', FIELDS);

    expect(result?.AND).toHaveLength(2);
    expect(result?.AND[0]?.OR?.[0]).toEqual({ code: { contains: 'acme', mode: 'insensitive' } });
    expect(result?.AND[1]?.OR?.[0]).toEqual({ code: { contains: 'components', mode: 'insensitive' } });
  });

  it('collapses runs of whitespace rather than producing empty terms', () => {
    expect(searchAcross<FakeWhere>('  acme   components  ', FIELDS)?.AND).toHaveLength(2);
  });

  it('does not lower-case the term, because the match is already case-insensitive', () => {
    expect(searchAcross<FakeWhere>('ACME', FIELDS)?.AND[0]?.OR?.[0]).toEqual({ code: { contains: 'ACME', mode: 'insensitive' } });
  });
});
