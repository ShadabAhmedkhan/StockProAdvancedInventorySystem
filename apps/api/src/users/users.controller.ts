import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { PublicUser } from '../auth/dto/auth-response.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import type { Paginated } from '../common/pagination/paginated';
import { UserRole } from '../generated/prisma/enums';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserQueryDto } from './dto/user-query.dto';
import { UsersService } from './users.service';

/**
 * There is deliberately no DELETE. Users are referenced by stock movements,
 * orders and every other ledger, all of which use ON DELETE RESTRICT so history
 * stays attributable. Deactivating through PATCH /:id/status is the supported
 * way to remove someone's access.
 */
@ApiBearerAuth('access-token')
@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Get()
  @ApiOperation({ summary: 'List users with pagination, search and filters' })
  findAll(@Query() query: UserQueryDto): Promise<Paginated<PublicUser>> {
    return this.usersService.findAll(query);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Get(':id')
  @ApiOperation({ summary: 'Get a single user' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<PublicUser> {
    return this.usersService.findOne(id);
  }

  @Roles(UserRole.ADMIN)
  @Post()
  @ApiOperation({ summary: 'Create a user with an explicit role' })
  create(@Body() dto: CreateUserDto): Promise<PublicUser> {
    return this.usersService.create(dto);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id')
  @ApiOperation({ summary: 'Update a user profile' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto): Promise<PublicUser> {
    return this.usersService.update(id, dto);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id/role')
  @ApiOperation({ summary: 'Change a user role' })
  changeRole(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserRoleDto, @CurrentUser() caller: AuthenticatedUser): Promise<PublicUser> {
    return this.usersService.changeRole(id, dto.role, caller.id);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id/status')
  @ApiOperation({ summary: 'Activate, deactivate or suspend a user' })
  changeStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserStatusDto, @CurrentUser() caller: AuthenticatedUser): Promise<PublicUser> {
    return this.usersService.changeStatus(id, dto.status, caller.id);
  }
}
