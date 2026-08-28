import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import type { Paginated } from '../common/pagination/paginated';
import type { Location, UserLocationAccess } from '../generated/prisma/client';
import { UserRole } from '../generated/prisma/enums';
import { CreateLocationDto } from './dto/create-location.dto';
import { GrantLocationAccessDto } from './dto/grant-location-access.dto';
import { LocationQueryDto } from './dto/location-query.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { LocationsService } from './locations.service';

/**
 * Any authenticated user may read locations - staff need to know where they
 * work. Writing (and managing access restrictions) is limited to ADMIN and
 * MANAGER, the same as suppliers: who's allowed to create/edit a location is
 * an org-admin concern, not a selling concern. Granting/revoking access is
 * ADMIN-only, since it directly controls what other users may reach.
 */
@ApiBearerAuth('access-token')
@ApiTags('Locations')
@Controller('locations')
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  @Get()
  @ApiOperation({ summary: 'List locations with pagination and search' })
  findAll(@Query() query: LocationQueryDto): Promise<Paginated<Location>> {
    return this.locationsService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single location' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<Location> {
    return this.locationsService.findOne(id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post()
  @ApiOperation({ summary: 'Create a location' })
  create(@Body() dto: CreateLocationDto): Promise<Location> {
    return this.locationsService.create(dto);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Patch(':id')
  @ApiOperation({ summary: 'Update a location' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLocationDto): Promise<Location> {
    return this.locationsService.update(id, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete a location; refused for the default location' })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<Location> {
    return this.locationsService.remove(id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Restore a soft-deleted location' })
  restore(@Param('id', ParseUUIDPipe) id: string): Promise<Location> {
    return this.locationsService.restore(id);
  }

  @Get(':id/access')
  @ApiOperation({ summary: 'List users restricted to this location' })
  listAccess(@Param('id', ParseUUIDPipe) id: string): Promise<UserLocationAccess[]> {
    return this.locationsService.listAccess(id);
  }

  @Roles(UserRole.ADMIN)
  @Post(':id/access')
  @ApiOperation({ summary: "Grant a user access to this location, restricting them to their allow-list" })
  grantAccess(@Param('id', ParseUUIDPipe) id: string, @Body() dto: GrantLocationAccessDto): Promise<UserLocationAccess> {
    return this.locationsService.grantAccess(id, dto.userId);
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id/access/:userId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke a user access restriction for this location' })
  revokeAccess(@Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string): Promise<void> {
    return this.locationsService.revokeAccess(id, userId);
  }
}
