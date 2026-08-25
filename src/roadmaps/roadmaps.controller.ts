import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  CompleteNodeDto,
  CreateDirectoryDto,
  CreateRoadmapDto,
  MoveDirectoryDto,
  RenameDirectoryDto,
  RoadmapListQueryDto,
  UpdateRoadmapDto,
} from './roadmaps.dto';
import { RoadmapReactionType } from './entities/roadmap.entities';
import { RoadmapsService } from './roadmaps.service';

@ApiTags('roadmaps')
@Controller('roadmaps')
export class RoadmapsController {
  constructor(private readonly roadmaps: RoadmapsService) {}

  @Get('public')
  listPublic(@Query() query: RoadmapListQueryDto) {
    return this.roadmaps.listPublic(query);
  }

  @Get('public/:id')
  getPublic(@Param('id', ParseUUIDPipe) id: string) {
    return this.roadmaps.getPublic(id);
  }

  @Get('mine')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  listMine(@CurrentUser() user: AuthUser, @Query() query: RoadmapListQueryDto) {
    return this.roadmaps.listMine(user.id, query);
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateRoadmapDto) {
    return this.roadmaps.create(user.id, dto);
  }

  @Get(':id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  getOwned(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.roadmaps.getOwned(user.id, id);
  }

  @Patch(':id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoadmapDto,
  ) {
    return this.roadmaps.update(user.id, id, dto);
  }

  @Delete(':id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.roadmaps.remove(user.id, id);
  }

  @Post(':id/fork')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  fork(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.roadmaps.fork(user.id, id);
  }

  @Get('public/:id/fork-tree')
  getForkTree(@Param('id', ParseUUIDPipe) id: string) {
    return this.roadmaps.getForkTree(id);
  }

  @Get(':id/fork-status')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  getForkStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.roadmaps.getForkStatus(user.id, id);
  }

  @Put(':id/reactions/:type')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  addReaction(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('type', new ParseEnumPipe(RoadmapReactionType)) type: RoadmapReactionType,
  ) {
    return this.roadmaps.setReaction(user.id, id, type, true);
  }

  @Delete(':id/reactions/:type')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  removeReaction(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('type', new ParseEnumPipe(RoadmapReactionType)) type: RoadmapReactionType,
  ) {
    return this.roadmaps.setReaction(user.id, id, type, false);
  }

  @Put(':id/nodes/:nodeId/progress')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  completeNode(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('nodeId') nodeId: string,
    @Body() dto: CompleteNodeDto,
  ) {
    return this.roadmaps.completeNode(user.id, id, nodeId, dto);
  }

  @Get(':id/progress')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  getProgress(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.roadmaps.getProgress(user.id, id);
  }
}

@ApiTags('directories')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('directories')
export class DirectoriesController {
  constructor(private readonly roadmaps: RoadmapsService) {}

  @Get('tree')
  list(@CurrentUser() user: AuthUser) {
    return this.roadmaps.listDirectories(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateDirectoryDto) {
    return this.roadmaps.createDirectory(user.id, dto);
  }

  @Patch(':id/parent')
  move(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MoveDirectoryDto,
  ) {
    return this.roadmaps.moveDirectory(user.id, id, dto);
  }

  @Patch(':id')
  rename(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenameDirectoryDto,
  ) {
    return this.roadmaps.renameDirectory(user.id, id, dto.name);
  }

  @Delete(':id')
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.roadmaps.deleteDirectory(user.id, id);
  }
}
