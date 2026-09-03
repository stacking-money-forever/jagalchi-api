import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'node:crypto';
import { DataSource, IsNull, MoreThan, Repository } from 'typeorm';
import { RealtimeConnectionTicket } from './realtime-ticket.entity';

const TICKET_TTL_MS = 60_000;

@Injectable()
export class RealtimeTicketService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(RealtimeConnectionTicket)
    private readonly tickets: Repository<RealtimeConnectionTicket>,
  ) {}

  async issue(userId: string, audience = 'roadmaps') {
    const ticket = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + TICKET_TTL_MS);
    await this.tickets.save(this.tickets.create({
      userId, audience, tokenHash: this.hash(ticket), expiresAt, consumedAt: null,
    }));
    return { ticket, audience, expiresAt: expiresAt.toISOString() };
  }

  consume(rawTicket: string, audience = 'roadmaps'): Promise<string | null> {
    return this.dataSource.transaction(async (manager) => {
      const tickets = manager.getRepository(RealtimeConnectionTicket);
      const ticket = await tickets.findOne({
        where: {
          tokenHash: this.hash(rawTicket), audience, consumedAt: IsNull(), expiresAt: MoreThan(new Date()),
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (!ticket) return null;
      ticket.consumedAt = new Date();
      await tickets.save(ticket);
      return ticket.userId;
    });
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
