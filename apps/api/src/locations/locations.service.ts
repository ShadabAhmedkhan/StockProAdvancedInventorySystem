import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ErrorCode } from '../common/enums/error-code.enum';
import { pageWindow, paginate, type Paginated } from '../common/pagination/paginated';
import { searchAcross } from '../common/pagination/search.util';
import { getCurrentOrgId } from '../common/tenant/tenant-context';
import type { Location, Prisma, UserLocationAccess } from '../generated/prisma/client';
import { TENANT_PRISMA, type TenantPrismaClient } from '../prisma/tenant-prisma.provider';
import type { CreateLocationDto } from './dto/create-location.dto';
import type { LocationQueryDto } from './dto/location-query.dto';
import type { UpdateLocationDto } from './dto/update-location.dto';

@Injectable()
export class LocationsService {
  constructor(@Inject(TENANT_PRISMA) private readonly prisma: TenantPrismaClient) {}

  async findAll(query: LocationQueryDto): Promise<Paginated<Location>> {
    const where = buildWhere(query);
    const { skip, take } = pageWindow(query.page, query.limit);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.location.findMany({ where, orderBy: { [query.sortBy]: query.sortOrder }, skip, take }),
      this.prisma.location.count({ where }),
    ]);

    return paginate(items, total, query.page, query.limit);
  }

  /**
   * @param includeDeleted Needed by the restore flow, which by definition has
   * to look at a record that ordinary reads hide.
   */
  async findOne(id: string, includeDeleted = false): Promise<Location> {
    const location = await this.prisma.location.findUnique({ where: { id } });

    if (location === null || (!includeDeleted && location.deletedAt !== null)) {
      throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'Location not found' });
    }

    return location;
  }

  async create(dto: CreateLocationDto): Promise<Location> {
    return this.prisma.location.create({
      data: {
        organizationId: getCurrentOrgId(),
        name: dto.name,
        type: dto.type,
        address: dto.address ?? null,
      },
    });
  }

  async update(id: string, dto: UpdateLocationDto): Promise<Location> {
    await this.findOne(id);

    return this.prisma.location.update({
      where: { id },
      data: {
        ...(dto.name === undefined ? {} : { name: dto.name }),
        ...(dto.type === undefined ? {} : { type: dto.type }),
        ...(dto.address === undefined ? {} : { address: dto.address }),
      },
    });
  }

  /**
   * Soft delete. Refused for the organization's default location: every stock
   * operation resolves it internally, so deleting it would strand every
   * product's inventory - the same "refuse with a clear reason" pattern used
   * elsewhere in this codebase (e.g. `Order.cancel` once money has moved).
   */
  async remove(id: string): Promise<Location> {
    const location = await this.findOne(id);

    if (location.isDefault) {
      throw new ConflictException({
        code: ErrorCode.CONFLICT,
        message: 'The default location cannot be deleted',
      });
    }

    return this.prisma.location.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async restore(id: string): Promise<Location> {
    const location = await this.findOne(id, true);

    if (location.deletedAt === null) {
      throw new ConflictException({ code: ErrorCode.CONFLICT, message: 'Location is not deleted' });
    }

    return this.prisma.location.update({ where: { id }, data: { deletedAt: null } });
  }

  /**
   * Grants a user access to this location. A user with any `UserLocationAccess`
   * rows is restricted to those locations; granting the first row for a user
   * moves them from unrestricted to restricted. See the doc comment on
   * `UserLocationAccess` in schema.prisma for the full "empty = unrestricted"
   * semantics.
   */
  async grantAccess(locationId: string, userId: string): Promise<UserLocationAccess> {
    await this.findOne(locationId);
    await this.assertUserInOrg(userId);

    const existing = await this.prisma.userLocationAccess.findUnique({
      where: { userId_locationId: { userId, locationId } },
    });
    if (existing !== null) {
      return existing;
    }

    return this.prisma.userLocationAccess.create({ data: { userId, locationId } });
  }

  async revokeAccess(locationId: string, userId: string): Promise<void> {
    await this.findOne(locationId);

    await this.prisma.userLocationAccess.deleteMany({ where: { userId, locationId } });
  }

  async listAccess(locationId: string): Promise<UserLocationAccess[]> {
    await this.findOne(locationId);

    return this.prisma.userLocationAccess.findMany({ where: { locationId } });
  }

  private async assertUserInOrg(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });

    if (user === null) {
      throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'User not found' });
    }
  }
}

/** Columns a free-text search looks at. Module-owned, never caller-supplied. */
const SEARCHABLE_FIELDS = ['name', 'address'] as const;

function buildWhere(query: LocationQueryDto): Prisma.LocationWhereInput {
  const filters: Prisma.LocationWhereInput = {
    ...(query.includeDeleted ? {} : { deletedAt: null }),
  };

  const search = searchAcross<Prisma.LocationWhereInput>(query.search, SEARCHABLE_FIELDS);

  return search === undefined ? filters : { ...filters, ...search };
}
