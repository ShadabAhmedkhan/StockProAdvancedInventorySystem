import { SettingValueType } from '../generated/prisma/enums';

export interface SettingWithParsedValue {
  id: string;
  key: string;
  value: string;
  valueType: SettingValueType;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** `value` decoded according to `valueType`, computed at read time rather than stored twice. */
  parsedValue: unknown;
}

export function withParsedValue<T extends { value: string; valueType: SettingValueType }>(setting: T): T & { parsedValue: unknown } {
  return { ...setting, parsedValue: parseSettingValue(setting.value, setting.valueType) };
}

export function parseSettingValue(value: string, valueType: SettingValueType): unknown {
  switch (valueType) {
    case SettingValueType.NUMBER:
      return Number(value);
    case SettingValueType.BOOLEAN:
      return value === 'true';
    case SettingValueType.JSON:
      return JSON.parse(value) as unknown;
    case SettingValueType.STRING:
      return value;
  }
}

/** `null` when `value` is well-formed for `valueType`, otherwise a message naming what is wrong. */
export function invalidValueReason(value: string, valueType: SettingValueType): string | null {
  switch (valueType) {
    case SettingValueType.NUMBER:
      return Number.isFinite(Number(value)) ? null : 'value must be a valid number for valueType NUMBER';
    case SettingValueType.BOOLEAN:
      return value === 'true' || value === 'false' ? null : "value must be 'true' or 'false' for valueType BOOLEAN";
    case SettingValueType.JSON:
      try {
        JSON.parse(value);
        return null;
      } catch {
        return 'value must be valid JSON for valueType JSON';
      }
    case SettingValueType.STRING:
      return null;
  }
}
