import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, Repository } from 'typeorm';
import {
  CompleteNodeDto,
  CreateDirectoryDto,
  CreateRoadmapDto,
  MoveDirectoryDto,
  RoadmapListQueryDto,
  UpdateRoadmapDto,
} from './roadmaps.dto';
import {
  NodeProgress,
  Roadmap,
  RoadmapDirectory,
  type RoadmapGraph,
  RoadmapReaction,
  RoadmapReactionType,
  RoadmapVisibility,
} from './entities/roadmap.entities';

const EMPTY_GRAPH: RoadmapGraph = { schemaVersion: 1, nodes: [], edges: [] };

@Injectable()
export class RoadmapsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Roadmap) private readonly roadmaps: Repository<Roadmap>,
    @InjectRepository(RoadmapDirectory)
    private readonly directories: Repository<RoadmapDirectory>,
    @InjectRepository(NodeProgress)
    private readonly progress: Repository<NodeProgress>,
    @InjectRepository(RoadmapReaction)
    private readonly reactions: Repository<RoadmapReaction>,
  ) {}

  async create(ownerId: string, dto: CreateRoadmapDto): Promise<Roadmap> {
    if (dto.directoryId) await this.requireDirectory(ownerId, dto.directoryId);
    const graph = dto.graph ?? EMPTY_GRAPH;
    this.assertValidGraph(graph);
    return this.roadmaps.save(
      this.roadmaps.create({
        ownerId,
        title: dto.title.trim(),
        description: dto.description?.trim() ?? '',
        tags: this.normalizeTags(dto.tags ?? []),
        visibility: dto.visibility,
        graph,
        directoryId: dto.directoryId ?? null,
        forkedFromId: null,
      }),
    );
  }

  async listPublic(query: RoadmapListQueryDto) {
    const builder = this.roadmaps
      .createQueryBuilder('roadmap')
      .where('roadmap.visibility = :visibility', { visibility: RoadmapVisibility.Public })
      .orderBy('roadmap.updated_at', 'DESC')
      .skip((query.page - 1) * query.size)
      .take(query.size);

    const search = query.search?.trim();
    if (search) {
      builder.andWhere(
        new Brackets((where) => {
          where
            .where('roadmap.title ILIKE :search', { search: `%${search}%` })
            .orWhere('roadmap.description ILIKE :search', { search: `%${search}%` });
        }),
      );
    }
    if (query.tag?.trim()) {
      builder.andWhere(':tag = ANY(roadmap.tags)', { tag: query.tag.trim().toLowerCase() });
    }
    if (query.ownerId) {
      builder.andWhere('roadmap.owner_id = :ownerId', { ownerId: query.ownerId });
    }

    const [items, total] = await builder.getManyAndCount();
    return { items, page: query.page, size: query.size, total };
  }

  async listMine(ownerId: string, query: RoadmapListQueryDto) {
    const builder = this.roadmaps
      .createQueryBuilder('roadmap')
      .where('roadmap.owner_id = :ownerId', { ownerId })
      .orderBy('roadmap.updated_at', 'DESC')
      .skip((query.page - 1) * query.size)
      .take(query.size);
    if (query.search?.trim()) {
      builder.andWhere('roadmap.title ILIKE :search', {
        search: `%${query.search.trim()}%`,
      });
    }
    const [items, total] = await builder.getManyAndCount();
    return { items, page: query.page, size: query.size, total };
  }

  async getPublic(id: string): Promise<Roadmap> {
    const roadmap = await this.roadmaps.findOne({ where: { id } });
    if (
      !roadmap ||
      (roadmap.visibility !== RoadmapVisibility.Public &&
        roadmap.visibility !== RoadmapVisibility.Unlisted)
    ) {
      throw new NotFoundException('Roadmap not found');
    }
    return roadmap;
  }

  async getOwned(ownerId: string, id: string): Promise<Roadmap> {
    const roadmap = await this.roadmaps.findOne({ where: { id, ownerId } });
    if (!roadmap) throw new NotFoundException('Roadmap not found');
    return roadmap;
  }

  async update(ownerId: string, id: string, dto: UpdateRoadmapDto): Promise<Roadmap> {
    const roadmap = await this.getOwned(ownerId, id);
    if (dto.directoryId) await this.requireDirectory(ownerId, dto.directoryId);
    if (dto.graph) this.assertValidGraph(dto.graph);

    if (dto.title !== undefined) roadmap.title = dto.title.trim();
    if (dto.description !== undefined) roadmap.description = dto.description.trim();
    if (dto.tags !== undefined) roadmap.tags = this.normalizeTags(dto.tags);
    if (dto.visibility !== undefined) roadmap.visibility = dto.visibility;
    if (dto.graph !== undefined) roadmap.graph = dto.graph;
    if (dto.directoryId !== undefined) roadmap.directoryId = dto.directoryId;
    return this.roadmaps.save(roadmap);
  }

  async remove(ownerId: string, id: string): Promise<void> {
    const roadmap = await this.getOwned(ownerId, id);
    await this.roadmaps.softRemove(roadmap);
  }

  async fork(actorId: string, id: string): Promise<Roadmap> {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Roadmap);
      const source = await repository.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !source ||
        (source.ownerId !== actorId &&
          source.visibility !== RoadmapVisibility.Public &&
          source.visibility !== RoadmapVisibility.Unlisted)
      ) {
        throw new NotFoundException('Roadmap not found');
      }

      const fork = await repository.save(
        repository.create({
          ownerId: actorId,
          title: `${source.title} 포크`,
          description: source.description,
          tags: [...source.tags],
          visibility: RoadmapVisibility.Private,
          graph: structuredClone(source.graph),
          directoryId: null,
          forkedFromId: source.id,
        }),
      );
      source.forkCount += 1;
      await repository.save(source);
      return fork;
    });
  }

  async getForkStatus(actorId: string, id: string) {
    const roadmap = await this.getPublic(id);
    const forkedByCurrentUser = await this.roadmaps.exists({
      where: { ownerId: actorId, forkedFromId: id },
    });
    const original = roadmap.forkedFromId
      ? await this.roadmaps.findOne({ where: { id: roadmap.forkedFromId } })
      : null;
    return {
      roadmapId: roadmap.id,
      forkCount: roadmap.forkCount,
      originalRoadmapId: original?.id ?? null,
      originalRoadmapTitle: original?.title ?? null,
      forkedByCurrentUser,
    };
  }

  async getForkTree(id: string) {
    const roadmap = await this.getPublic(id);
    const children = await this.roadmaps.find({
      where: { forkedFromId: id },
      order: { createdAt: 'ASC' },
      take: 100,
    });
    return {
      id: roadmap.id,
      title: roadmap.title,
      ownerId: roadmap.ownerId,
      ownerName: '자갈치 학습자',
      forkCount: roadmap.forkCount,
      children: children.map((child) => ({
        id: child.id,
        title: child.title,
        ownerId: child.ownerId,
        ownerName: '자갈치 학습자',
        forkCount: child.forkCount,
        children: [],
      })),
    };
  }

  async setReaction(
    userId: string,
    roadmapId: string,
    type: RoadmapReactionType,
    active: boolean,
  ): Promise<{ active: boolean; count: number }> {
    return this.dataSource.transaction(async (manager) => {
      const roadmaps = manager.getRepository(Roadmap);
      const roadmap = await roadmaps.findOne({
        where: { id: roadmapId },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !roadmap ||
        (roadmap.ownerId !== userId &&
          roadmap.visibility !== RoadmapVisibility.Public &&
          roadmap.visibility !== RoadmapVisibility.Unlisted)
      ) {
        throw new NotFoundException('Roadmap not found');
      }

      const reactions = manager.getRepository(RoadmapReaction);
      const existing = await reactions.findOne({ where: { userId, roadmapId, type } });
      if (active && !existing) {
        await reactions.save(reactions.create({ userId, roadmapId, type }));
        if (type === RoadmapReactionType.Like) roadmap.likeCount += 1;
        else roadmap.favoriteCount += 1;
      } else if (!active && existing) {
        await reactions.remove(existing);
        if (type === RoadmapReactionType.Like) {
          roadmap.likeCount = Math.max(0, roadmap.likeCount - 1);
        } else {
          roadmap.favoriteCount = Math.max(0, roadmap.favoriteCount - 1);
        }
      }
      await roadmaps.save(roadmap);
      return {
        active,
        count:
          type === RoadmapReactionType.Like ? roadmap.likeCount : roadmap.favoriteCount,
      };
    });
  }

  async completeNode(
    userId: string,
    roadmapId: string,
    nodeId: string,
    dto: CompleteNodeDto,
  ): Promise<NodeProgress> {
    const roadmap = await this.roadmaps.findOne({ where: { id: roadmapId } });
    if (
      !roadmap ||
      (roadmap.ownerId !== userId &&
        roadmap.visibility !== RoadmapVisibility.Public &&
        roadmap.visibility !== RoadmapVisibility.Unlisted)
    ) {
      throw new NotFoundException('Roadmap not found');
    }
    if (!roadmap.graph.nodes.some((node) => node.id === nodeId)) {
      throw new BadRequestException('Node does not belong to this roadmap');
    }

    const current =
      (await this.progress.findOne({ where: { userId, roadmapId, nodeId } })) ??
      this.progress.create({ userId, roadmapId, nodeId });
    current.isCompleted = dto.isCompleted;
    current.note = dto.note?.trim() || null;
    current.link = dto.link ?? null;
    current.completedAt = dto.isCompleted ? new Date() : null;
    return this.progress.save(current);
  }

  async getProgress(userId: string, roadmapId: string) {
    const roadmap = await this.getPublic(roadmapId);
    const entries = await this.progress.find({
      where: { userId, roadmapId },
      order: { updatedAt: 'DESC' },
    });
    const completedNodeIds = entries
      .filter((entry) => entry.isCompleted)
      .map((entry) => entry.nodeId);
    const totalNodes = roadmap.graph.nodes.filter(
      (node) => node.type === 'jagalchi-node' || node.type === 'detail-node',
    ).length;
    return {
      roadmapId,
      totalNodes,
      completedNodes: completedNodeIds.length,
      progressPercentage:
        totalNodes > 0 ? Math.round((completedNodeIds.length / totalNodes) * 100) : 0,
      completedNodeIds,
      updatedAt: entries[0]?.updatedAt ?? roadmap.updatedAt,
    };
  }

  async listDirectories(userId: string): Promise<RoadmapDirectory[]> {
    return this.directories.find({ where: { userId }, order: { name: 'ASC' } });
  }

  async createDirectory(userId: string, dto: CreateDirectoryDto): Promise<RoadmapDirectory> {
    if (dto.parentId) await this.requireDirectory(userId, dto.parentId);
    try {
      return await this.directories.save(
        this.directories.create({
          userId,
          parentId: dto.parentId ?? null,
          name: dto.name.trim(),
        }),
      );
    } catch {
      throw new ConflictException('A directory with this name already exists');
    }
  }

  async moveDirectory(
    userId: string,
    directoryId: string,
    dto: MoveDirectoryDto,
  ): Promise<RoadmapDirectory> {
    const directory = await this.requireDirectory(userId, directoryId);
    if (dto.parentId === directoryId) {
      throw new BadRequestException('A directory cannot contain itself');
    }
    if (dto.parentId) {
      let current: string | null = dto.parentId;
      for (let depth = 0; current && depth < 100; depth += 1) {
        if (current === directoryId) {
          throw new BadRequestException('Directory cycle detected');
        }
        const parent = await this.requireDirectory(userId, current);
        current = parent.parentId;
      }
      if (current) throw new BadRequestException('Directory tree is too deep');
    }
    directory.parentId = dto.parentId ?? null;
    return this.directories.save(directory);
  }

  async renameDirectory(
    userId: string,
    directoryId: string,
    name: string,
  ): Promise<RoadmapDirectory> {
    const directory = await this.requireDirectory(userId, directoryId);
    directory.name = name.trim();
    return this.directories.save(directory);
  }

  async deleteDirectory(userId: string, directoryId: string): Promise<void> {
    const directory = await this.requireDirectory(userId, directoryId);
    const childCount = await this.directories.count({ where: { userId, parentId: directoryId } });
    if (childCount > 0) throw new ConflictException('Move child directories first');
    await this.roadmaps.update({ ownerId: userId, directoryId }, { directoryId: null });
    await this.directories.remove(directory);
  }

  private async requireDirectory(userId: string, id: string): Promise<RoadmapDirectory> {
    const directory = await this.directories.findOne({ where: { id, userId } });
    if (!directory) throw new ForbiddenException('Directory is not available');
    return directory;
  }

  private normalizeTags(tags: string[]): string[] {
    return [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
  }

  private assertValidGraph(graph: RoadmapGraph): void {
    if (
      graph.schemaVersion !== 1 ||
      !Array.isArray(graph.nodes) ||
      !Array.isArray(graph.edges) ||
      graph.nodes.length > 1_000 ||
      graph.edges.length > 2_000
    ) {
      throw new BadRequestException('Invalid roadmap graph');
    }
    const nodeIds = new Set<string>();
    for (const node of graph.nodes) {
      if (
        !node ||
        typeof node.id !== 'string' ||
        !['jagalchi-node', 'jagalchi-section', 'jagalchi-text', 'detail-node'].includes(
          node.type,
        ) ||
        !node.position ||
        !Number.isFinite(node.position.x) ||
        !Number.isFinite(node.position.y) ||
        nodeIds.has(node.id)
      ) {
        throw new BadRequestException('Invalid roadmap node');
      }
      nodeIds.add(node.id);
    }
    const edgeIds = new Set<string>();
    for (const edge of graph.edges) {
      if (
        !edge ||
        typeof edge.id !== 'string' ||
        edgeIds.has(edge.id) ||
        !nodeIds.has(edge.source) ||
        !nodeIds.has(edge.target) ||
        edge.source === edge.target
      ) {
        throw new BadRequestException('Invalid roadmap edge');
      }
      edgeIds.add(edge.id);
    }
  }
}
