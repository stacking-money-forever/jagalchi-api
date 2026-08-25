import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import type { Server, Socket } from 'socket.io';
import {
  SequenceConflictError,
  RealtimeService,
} from './realtime.service';
import {
  parseEditRequest,
  type EditAck,
  type EditNack,
} from './realtime.types';

const allowedOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

type Ack = (value: EditAck | EditNack) => void;
type AuthenticatedSocket = Socket & {
  data: { userId?: string; lastCursorAt?: number; joinedRoadmaps?: Set<string> };
};

@WebSocketGateway({
  namespace: '/roadmaps',
  cors: { origin: allowedOrigins, credentials: true },
  transports: ['websocket'],
  maxHttpBufferSize: 128_000,
})
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly realtime: RealtimeService,
  ) {}

  async handleConnection(client: AuthenticatedSocket): Promise<void> {
    const authToken =
      typeof client.handshake.auth?.token === 'string'
        ? client.handshake.auth.token
        : this.readBearer(client.handshake.headers.authorization);
    if (!authToken) {
      client.disconnect(true);
      return;
    }
    try {
      const payload = await this.jwt.verifyAsync<{ sub?: string }>(authToken);
      if (!payload.sub) throw new Error('Missing subject');
      client.data.userId = payload.sub;
      client.data.joinedRoadmaps = new Set();
    } catch {
      client.disconnect(true);
    }
  }

  @SubscribeMessage('roadmap:join')
  async join(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() value: unknown,
    ack?: Ack,
  ): Promise<void> {
    const roadmapId =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>).roadmapId
        : null;
    if (
      !client.data.userId ||
      typeof roadmapId !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(roadmapId)
    ) {
      ack?.({ ok: false, code: 'INVALID_OPERATION', message: 'Invalid roadmap room' });
      return;
    }
    try {
      const sequence = await this.realtime.currentSequence(client.data.userId, roadmapId);
      await client.join(this.room(roadmapId));
      client.data.joinedRoadmaps?.add(roadmapId);
      ack?.({ ok: true, duplicate: false, sequence, eventId: 'joined' });
    } catch {
      ack?.({ ok: false, code: 'FORBIDDEN', message: 'Roadmap is not editable' });
    }
  }

  @SubscribeMessage('roadmap:edit')
  async edit(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() value: unknown,
    ack?: Ack,
  ): Promise<void> {
    const request = parseEditRequest(value);
    if (!client.data.userId || !request) {
      ack?.({ ok: false, code: 'INVALID_OPERATION', message: 'Invalid edit request' });
      return;
    }
    try {
      const result = await this.realtime.append(client.data.userId, request);
      ack?.(result);
      if (!result.duplicate) {
        client.to(this.room(request.roadmapId)).emit('roadmap:event', {
          roadmapId: request.roadmapId,
          eventId: result.eventId,
          sequence: result.sequence,
          actorId: client.data.userId,
          operation: request.operation,
        });
      }
    } catch (error) {
      if (error instanceof SequenceConflictError) {
        ack?.({
          ok: false,
          code: 'SEQUENCE_CONFLICT',
          message: error.message,
          currentSequence: error.currentSequence,
        });
      } else {
        ack?.({ ok: false, code: 'FORBIDDEN', message: 'Edit was rejected' });
      }
    }
  }

  @SubscribeMessage('roadmap:cursor')
  cursor(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() value: unknown,
  ): void {
    const now = Date.now();
    if (!client.data.userId || now - (client.data.lastCursorAt ?? 0) < 50) return;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const cursor = value as Record<string, unknown>;
    if (
      typeof cursor.roadmapId !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(cursor.roadmapId) ||
      !client.data.joinedRoadmaps?.has(cursor.roadmapId) ||
      !Number.isFinite(cursor.x) ||
      !Number.isFinite(cursor.y)
    ) {
      return;
    }
    client.data.lastCursorAt = now;
    client.to(this.room(cursor.roadmapId)).emit('roadmap:cursor', {
      roadmapId: cursor.roadmapId,
      actorId: client.data.userId,
      x: cursor.x,
      y: cursor.y,
    });
  }

  @SubscribeMessage('roadmap:cursor-hide')
  hideCursor(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() value: unknown): void {
    const roadmapId =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>).roadmapId
        : null;
    if (
      !client.data.userId ||
      typeof roadmapId !== 'string' ||
      !client.data.joinedRoadmaps?.has(roadmapId)
    ) {
      return;
    }
    client.to(this.room(roadmapId)).emit('roadmap:cursor-hide', {
      roadmapId,
      actorId: client.data.userId,
    });
  }

  private room(roadmapId: string): string {
    return `roadmap:${roadmapId}`;
  }

  private readBearer(value: string | string[] | undefined): string | undefined {
    if (typeof value !== 'string' || !value.startsWith('Bearer ')) return undefined;
    return value.slice(7);
  }
}
