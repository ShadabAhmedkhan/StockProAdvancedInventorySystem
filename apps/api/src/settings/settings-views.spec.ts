import { SettingValueType } from '../generated/prisma/enums';
import { invalidValueReason, parseSettingValue, withParsedValue } from './settings-views';

describe('parseSettingValue', () => {
  it('parses a NUMBER', () => {
    expect(parseSettingValue('42.5', SettingValueType.NUMBER)).toBe(42.5);
  });

  it('parses a BOOLEAN', () => {
    expect(parseSettingValue('true', SettingValueType.BOOLEAN)).toBe(true);
    expect(parseSettingValue('false', SettingValueType.BOOLEAN)).toBe(false);
  });

  it('parses JSON', () => {
    expect(parseSettingValue('{"tax":8}', SettingValueType.JSON)).toEqual({ tax: 8 });
  });

  it('leaves a STRING untouched', () => {
    expect(parseSettingValue('hello', SettingValueType.STRING)).toBe('hello');
  });
});

describe('invalidValueReason', () => {
  it('accepts a well-formed value for every type', () => {
    expect(invalidValueReason('42', SettingValueType.NUMBER)).toBeNull();
    expect(invalidValueReason('true', SettingValueType.BOOLEAN)).toBeNull();
    expect(invalidValueReason('[1,2,3]', SettingValueType.JSON)).toBeNull();
    expect(invalidValueReason('anything', SettingValueType.STRING)).toBeNull();
  });

  it('rejects a non-numeric value for NUMBER', () => {
    expect(invalidValueReason('not-a-number', SettingValueType.NUMBER)).toMatch(/valid number/);
  });

  it('rejects anything other than true or false for BOOLEAN', () => {
    expect(invalidValueReason('yes', SettingValueType.BOOLEAN)).toMatch(/true.*false/);
  });

  it('rejects malformed JSON for JSON', () => {
    expect(invalidValueReason('{not json}', SettingValueType.JSON)).toMatch(/valid JSON/);
  });
});

describe('withParsedValue', () => {
  it('adds parsedValue without disturbing the stored fields', () => {
    const setting = { key: 'tax_rate', value: '8', valueType: SettingValueType.NUMBER };

    const result = withParsedValue(setting);

    expect(result.value).toBe('8');
    expect(result.parsedValue).toBe(8);
  });
});
