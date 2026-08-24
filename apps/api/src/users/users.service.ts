import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { PublicUser } from '../auth/dto/auth-response.dto';
import { RefreshTokenService } from '../auth/refresh-token.service';
import { AuditService } from '../audit/audit.service';
import { ErrorCode } from '../common/enums/error-code.enum';
import { pageWindow, paginate, type Paginated } from '../common/pagination/paginated';
import { hashPassword } from '../common/utils/password.util';
import type { Prisma } from '../generated/prisma/client';
import { AuditAction, AuditEntity, UserRole, UserStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateUserDto } from './dto/create-user.dto';
import type { UpdateUserDto } from './dto/update-user.dto';
import type { UserQueryDto } from './dto/user-query.dto';

const PUBLIC_USER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  role: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly auditService: AuditService,
  ) {}

  async findAll(query: UserQueryDto): Promise<Paginated<PublicUser>> {
    const where = buildWhere(query);
    const { skip, take } = pageWindow(query.page, query.limit);

    // One round trip for both halves; counting separately would let the page
    // and the total disagree under concurrent writes.
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({ where, select: PUBLIC_USER_SELECT, orderBy: { [query.sortBy]: query.sortOrder }, skip, take }),
      this.prisma.user.count({ where }),
    ]);

    return paginate(items, total, query.page, query.limit);
  }

  async findOne(id: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id }, select: PUBLIC_USER_SELECT });

    if (user === null) {
      throw new NotFoundException({ code: ErrorCode.NOT_FOUND, message: 'User not found' });
    }

    return user;
  }

  async create(dto: CreateUserDto, callerId: string): Promise<PublicUser> {
    await this.assertEmailAvailable(dto.email);

    const user = await this.prisma.user.create({
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email,
        passwordHash: await hashPassword(dto.password),
        role: dto.role,
        status: dto.status,
      },
      select: PUBLIC_USER_SELECT,
    });

    await this.auditService.record({
      userId: callerId,
      action: AuditAction.CREATE,
      entity: AuditEntity.USER,
      entityId: user.id,
      metadata: { email: user.email, role: user.role },
    });

    return user;
  }

  async update(id: string, dto: UpdateUserDto): Promise<PublicUser> {
    await this.findOne(id);

    if (dto.email !== undefined) {
      await this.assertEmailAvailable(dto.email, id);
    }

    return this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.firstName === undefined ? {} : { firstName: dto.firstName }),
        ...(dto.lastName === undefined ? {} : { lastName: dto.lastName }),
        ...(dto.email === undefined ? {} : { email: dto.email }),
      },
      select: PUBLIC_USER_SELECT,
    });
  }

  /**
   * Changes a role.
   *
   * Refuses to act on the caller's own account: an administrator who demotes
   * themselves cannot undo it, and refuses to remove the last active
   * administrator, which would leave the deployment with nobody able to
   * manage users.
   */
  async changeRole(id: string, role: UserRole, callerId: string): Promise<PublicUser> {
    const user = await this.findOne(id);

    if (id === callerId) {
      throw new BadRequestException({ code: ErrorCode.BAD_REQUEST, message: 'You cannot change your own role' });
    }

    if (user.role === UserRole.ADMIN && role !== UserRole.ADMIN) {
      await this.assertNotLastActiveAdmin(id);
    }

    const updated = await this.prisma.user.update({ where: { id }, data: { role }, select: PUBLIC_USER_SELECT });

    await this.auditService.record({
      userId: callerId,
      action: AuditAction.ROLE_CHANGED,
      entity: AuditEntity.USER,
      entityId: id,
      metadata: { from: user.role, to: role },
    });

    return updated;
  }

  /**
   * Changes a status. Anything other than ACTIVE ends the user's sessions
   * immediately, so a suspension does not wait out the refresh-token lifetime.
   */
  async changeStatus(id: string, status: UserStatus, callerId: string): Promise<PublicUser> {
    const user = await this.findOne(id);

    if (id === callerId) {
      throw new BadRequestException({ code: ErrorCode.BAD_REQUEST, message: 'You cannot change your own status' });
    }

    if (user.role === UserRole.ADMIN && status !== UserStatus.ACTIVE) {
      await this.assertNotLastActiveAdmin(id);
    }

    const updated = await this.prisma.user.update({ where: { id }, data: { status }, select: PUBLIC_USER_SELECT });

    if (status !== UserStatus.ACTIVE) {
      await this.refreshTokens.revokeAllForUser(id);
    }

    await this.auditService.record({
      userId: callerId,
      action: AuditAction.STATUS_CHANGED,
      entity: AuditEntity.USER,
      entityId: id,
      metadata: { from: user.status, to: status },
    });

    return updated;
  }

  private async assertEmailAvailable(email: string, exceptUserId?: string): Promise<void> {
    const existing = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });

    if (existing !== null && existing.id !== exceptUserId) {
      throw new ConflictException({ code: ErrorCode.CONFLICT, message: 'An account with this email already exists' });
    }
  }

  private async assertNotLastActiveAdmin(id: string): Promise<void> {
    const others = await this.prisma.user.count({
      where: { role: UserRole.ADMIN, status: UserStatus.ACTIVE, id: { not: id } },
    });

    if (others === 0) {
      throw new BadRequestException({ code: ErrorCode.BAD_REQUEST, message: 'The last active administrator cannot be demoted or deactivated' });
    }
  }
}

function buildWhere(query: UserQueryDto): Prisma.UserWhereInput {
  const filters: Prisma.UserWhereInput = {
    ...(query.role === undefined ? {} : { role: query.role }),
    ...(query.status === undefined ? {} : { status: query.status }),
  };

  if (query.search === undefined || query.search === '') {
    return filters;
  }

  const search = query.search;

  return {
    ...filters,
    OR: [
      { firstName: { contains: search, mode: 'insensitive' } },
      { lastName: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ],
  };
}
