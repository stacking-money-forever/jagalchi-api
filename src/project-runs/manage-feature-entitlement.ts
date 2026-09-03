import type { DataSource } from 'typeorm';
import { User } from '../auth/auth.entities';
import { ProjectFeature, ProjectFeatureEntitlement } from './product-spine.entities';

export interface FeatureEntitlementCommand { operator: string; action: 'enable' | 'disable'; feature: ProjectFeature; email: string; expiresAt: Date | null; }
export interface FeatureEntitlementAudit { timestamp: string; operator: string; targetUserId: string; action: 'enable' | 'disable'; feature: ProjectFeature; before: { enabled: boolean; expiresAt: string | null } | null; after: { enabled: boolean; expiresAt: string | null }; }
const usage = 'Usage: feature-entitlement:manage -- --operator <id> <enable|disable> PROJECT_RUNS <email> [--expires-at <ISO|null>]';

export function parseFeatureEntitlementCommand(args: string[]): FeatureEntitlementCommand {
  if ((args.length !== 5 && args.length !== 7) || args[0] !== '--operator' || (args.length === 7 && args[5] !== '--expires-at')) throw new Error(usage);
  const operator = args[1]?.trim(); const action = args[2]; const feature = args[3]; const email = args[4]?.trim().toLowerCase();
  if (!operator || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(usage);
  if (action !== 'enable' && action !== 'disable') throw new Error(usage);
  if (feature !== ProjectFeature.ProjectRuns) throw new Error(usage);
  const rawExpiry = args[6];
  const expiresAt = !rawExpiry || rawExpiry === 'null' ? null : new Date(rawExpiry);
  if (expiresAt && Number.isNaN(expiresAt.getTime())) throw new Error('Expiry must be ISO 8601 or null');
  return { operator, action, feature, email, expiresAt };
}

export async function manageFeatureEntitlement(dataSource: DataSource, command: FeatureEntitlementCommand, emit: (event: FeatureEntitlementAudit) => void = (event) => console.log(JSON.stringify(event))): Promise<FeatureEntitlementAudit> {
  return dataSource.transaction(async (manager) => {
    const user = await manager.getRepository(User).findOne({ where: { email: command.email } });
    if (!user) throw new Error('Target user was not found');
    const repository = manager.getRepository(ProjectFeatureEntitlement);
    let entitlement = await repository.findOne({ where: { userId: user.id, feature: command.feature }, lock: { mode: 'pessimistic_write' } });
    const before = entitlement ? { enabled: entitlement.enabled, expiresAt: entitlement.expiresAt?.toISOString() ?? null } : null;
    const enabled = command.action === 'enable';
    const after = { enabled, expiresAt: command.expiresAt?.toISOString() ?? null };
    if (before?.enabled === after.enabled && before.expiresAt === after.expiresAt) throw new Error('No entitlement change');
    entitlement ??= repository.create({ userId: user.id, feature: command.feature, reason: 'operator', updatedBy: command.operator, enabled, expiresAt: command.expiresAt });
    entitlement.enabled = enabled; entitlement.expiresAt = command.expiresAt; entitlement.reason = 'operator'; entitlement.updatedBy = command.operator;
    await repository.save(entitlement);
    const event = { timestamp: new Date().toISOString(), operator: command.operator, targetUserId: user.id, action: command.action, feature: command.feature, before, after };
    emit(event); return event;
  });
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const command = parseFeatureEntitlementCommand(args);
  const { AppDataSource } = await import('../database/data-source');
  await AppDataSource.initialize();
  try { await manageFeatureEntitlement(AppDataSource, command); } finally { await AppDataSource.destroy(); }
}
if (require.main === module) void main().catch(() => { process.stderr.write('feature-entitlement:manage failed\n'); process.exitCode = 1; });
