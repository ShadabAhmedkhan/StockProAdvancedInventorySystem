import { slugify } from './slug.util';

describe('slugify', () => {
  it.each([
    ['Smartphones', 'smartphones'],
    ['Spare Parts', 'spare-parts'],
    ['Audio & Video', 'audio-video'],
    ['  Padded  Name  ', 'padded-name'],
    ['Screens/Displays', 'screens-displays'],
    ['USB-C Cables', 'usb-c-cables'],
    ['4K Monitors', '4k-monitors'],
    ['Multiple---Hyphens', 'multiple-hyphens'],
    ['-leading and trailing-', 'leading-and-trailing'],
  ])('turns %p into %p', (name: string, expected: string) => {
    expect(slugify(name)).toBe(expected);
  });

  it('folds diacritics rather than dropping the letters', () => {
    expect(slugify('Café Équipement')).toBe('cafe-equipement');
    expect(slugify('Jalapeño')).toBe('jalapeno');
  });

  it('produces a valid slug, never one with doubled or edge hyphens', () => {
    const slug = slugify('  ***Weird!!  Name??  ');

    expect(slug).toBe('weird-name');
    expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it.each([[''], ['   '], ['!!!'], ['---']])('returns an empty string for %p, so the caller must supply one', (name: string) => {
    expect(slugify(name)).toBe('');
  });

  it('returns an empty string for a name with nothing sluggable in Latin script', () => {
    // Refusing beats storing an empty unique key that the next such name collides with.
    expect(slugify('日本語')).toBe('');
  });
});
