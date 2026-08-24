import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuditService } from '../audit/audit.service';
import { firstCallArg } from '../common/testing/mock-args';
import { AuditAction, SettingValueType } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from './settings.service';

const USER_ID = '00000000-0000-4000-8000-0000000000ff';

function setting(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'setting-1',
    key: 'low_stock_alert_threshold',
    value: '5',
    valueType: SettingValueType.NUMBER,
    description: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('SettingsService', () => {
  let service: SettingsService;
  let findMany: jest.Mock;
  let findUnique: jest.Mock;
  let upsertMock: jest.Mock;
  let deleteMock: jest.Mock;
  let record: jest.Mock;

  beforeEach(async () => {
    findMany = jest.fn(() => Promise.resolve([setting()]));
    findUnique = jest.fn(() => Promise.resolve(setting()));
    upsertMock = jest.fn(() => Promise.resolve(setting()));
    deleteMock = jest.fn(() => Promise.resolve(setting()));
    record = jest.fn(() => Promise.resolve());

    const moduleRef = await Test.createTestingModule({
      providers: [
        SettingsService,
        { provide: PrismaService, useValue: { setting: { findMany, findUnique, upsert: upsertMock, delete: deleteMock } } },
        { provide: AuditService, useValue: { record } },
      ],
    }).compile();

    service = moduleRef.get(SettingsService);
  });

  describe('findAll', () => {
    it('decodes every value according to its type', async () => {
      const result = await service.findAll();

      expect(result[0]?.parsedValue).toBe(5);
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException for a key that does not exist', async () => {
      findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('upsert', () => {
    it('rejects a value that does not match its declared type', async () => {
      await expect(service.upsert('low_stock_alert_threshold', { value: 'not-a-number', valueType: SettingValueType.NUMBER }, USER_ID)).rejects.toThrow(
        BadRequestException,
      );
      expect(upsertMock).not.toHaveBeenCalled();
    });

    it('records CREATE for a key that does not exist yet', async () => {
      findUnique.mockResolvedValue(null);

      await service.upsert('new_key', { value: '1', valueType: SettingValueType.NUMBER }, USER_ID);

      expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: AuditAction.CREATE, userId: USER_ID }));
    });

    it('records UPDATE for a key that already exists', async () => {
      findUnique.mockResolvedValue({ id: 'setting-1' });

      await service.upsert('low_stock_alert_threshold', { value: '10', valueType: SettingValueType.NUMBER }, USER_ID);

      expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: AuditAction.UPDATE, userId: USER_ID }));
    });

    it('writes the value and type through to the upsert call', async () => {
      await service.upsert('low_stock_alert_threshold', { value: '10', valueType: SettingValueType.NUMBER, description: 'Reorder point' }, USER_ID);

      const { create } = firstCallArg(upsertMock) as { create: { value: string; valueType: SettingValueType; description: string | null } };
      expect(create.value).toBe('10');
      expect(create.description).toBe('Reorder point');
    });
  });

  describe('remove', () => {
    it('records DELETE and returns the removed setting', async () => {
      const removed = await service.remove('low_stock_alert_threshold', USER_ID);

      expect(removed.key).toBe('low_stock_alert_threshold');
      expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: AuditAction.DELETE, userId: USER_ID }));
    });

    it('throws NotFoundException for a key that does not exist', async () => {
      findUnique.mockResolvedValue(null);

      await expect(service.remove('missing', USER_ID)).rejects.toThrow(NotFoundException);
      expect(deleteMock).not.toHaveBeenCalled();
    });
  });
});
