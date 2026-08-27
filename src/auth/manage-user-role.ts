import type { DataSource } from 'typeorm';
import { User } from './auth.entities';

const manageableRoles = ['REVIEWER', 'TEACHER'] as const;

export type ManageableUserRole = (typeof manageableRoles)[number];
export type UserRoleAction = 'grant' | 'revoke';

export interface ManageUserRoleCommand {
  operator: string;
  action: UserRoleAction;
  role: ManageableUserRole;
  email: string;
}

export interface UserRoleAuditEvent {
  timestamp: string;
  operator: string;
  targetUserId: string;
  action: UserRoleAction;
  role: ManageableUserRole;
  beforeRoles: string[];
  afterRoles: string[];
}

const usage =
  'Usage: pnpm --filter @jagalchi/api user-role:manage -- --operator <operator-id> <grant|revoke> <REVIEWER|TEACHER> <email>';

export function parseManageUserRoleCommand(args: string[]): ManageUserRoleCommand {
  if (args.length !== 5 || args[0] !== '--operator') {
    throw new Error(usage);
  }

  const operator = args[1]?.trim();
  const action = args[2];
  const rawRole = args[3];
  const email = args[4]?.trim().toLowerCase();

  if (!operator) {
    throw new Error('An operator identifier is required');
  }
  if (action !== 'grant' && action !== 'revoke') {
    throw new Error(`Unknown action: ${action ?? ''}`);
  }
  if (!rawRole || !manageableRoles.includes(rawRole.toUpperCase() as ManageableUserRole)) {
    throw new Error(`Unsupported role: ${rawRole ?? ''}`);
  }
  if (!email) {
    throw new Error('A target email is required');
  }

  return {
    operator,
    action,
    role: rawRole.toUpperCase() as ManageableUserRole,
    email,
  };
}

function validateManageUserRoleCommand(command: ManageUserRoleCommand): void {
  if (!command.operator.trim()) {
    throw new Error('An operator identifier is required');
  }
  if (command.action !== 'grant' && command.action !== 'revoke') {
    throw new Error(`Unknown action: ${command.action}`);
  }
  if (!manageableRoles.includes(command.role)) {
    throw new Error(`Unsupported role: ${command.role}`);
  }
  if (!command.email.trim()) {
    throw new Error('A target email is required');
  }
}

export async function manageUserRole(
  dataSource: DataSource,
  command: ManageUserRoleCommand,
  emitAudit: (event: UserRoleAuditEvent) => void = (event) => {
    console.log(JSON.stringify(event));
  },
): Promise<UserRoleAuditEvent> {
  validateManageUserRoleCommand(command);

  const email = command.email.trim().toLowerCase();
  const users = dataSource.getRepository(User);
  const user = await users.findOne({ where: { email } });
  if (!user) {
    throw new Error(`Unknown user: ${email}`);
  }

  const beforeRoles = [...user.roles];
  const hasRole = beforeRoles.includes(command.role);
  if ((command.action === 'grant' && hasRole) || (command.action === 'revoke' && !hasRole)) {
    throw new Error(`No role change: user already ${command.action === 'grant' ? 'has' : 'lacks'} ${command.role}`);
  }

  const afterRoles =
    command.action === 'grant'
      ? [...beforeRoles, command.role]
      : beforeRoles.filter((role) => role !== command.role);

  await users.save({ ...user, roles: afterRoles });

  const auditEvent: UserRoleAuditEvent = {
    timestamp: new Date().toISOString(),
    operator: command.operator,
    targetUserId: user.id,
    action: command.action,
    role: command.role,
    beforeRoles,
    afterRoles,
  };
  emitAudit(auditEvent);
  return auditEvent;
}

export async function main(args: string[] = process.argv.slice(2)): Promise<void> {
  const command = parseManageUserRoleCommand(args);
  const { AppDataSource } = await import('../database/data-source');

  await AppDataSource.initialize();
  try {
    await manageUserRole(AppDataSource, command);
  } finally {
    await AppDataSource.destroy();
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
