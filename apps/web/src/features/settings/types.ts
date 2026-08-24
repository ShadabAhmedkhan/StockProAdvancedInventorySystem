export type SettingValueType = 'STRING' | 'NUMBER' | 'BOOLEAN' | 'JSON';

export interface Setting {
  id: string;
  key: string;
  value: string;
  valueType: SettingValueType;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  parsedValue: unknown;
}
