import type { CareerDiffSnapshot, CareerTargetVersion, ProjectPlanSnapshot } from './product-spine.entities';

export interface FocusCitation {
  id: string;
  label: string;
  quote: string | null;
}

export interface FocusGap {
  id: string;
  description: string;
}

export interface TaskFocusRefs {
  citationIds: string[];
  gapIds: string[];
}

export interface FocusContext {
  citations: FocusCitation[];
  gaps: FocusGap[];
  taskRefs: Record<string, TaskFocusRefs>;
}

const citationLabel = (item: Record<string, unknown>, fallback: string): string => {
  if (typeof item.label === 'string' && item.label.trim()) return item.label.trim();
  if (typeof item.text === 'string' && item.text.trim()) return item.text.trim();
  if (typeof item.statement === 'string' && item.statement.trim()) return item.statement.trim();
  return fallback;
};

export function buildFocusContext(
  planSnapshot: ProjectPlanSnapshot | null | undefined,
  diff: CareerDiffSnapshot | null | undefined,
  targetVersion: CareerTargetVersion | null | undefined,
): FocusContext {
  const citations = new Map<string, FocusCitation>();
  const ingestCitation = (item: unknown, fallback: string) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return;
    const record = item as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id : fallback;
    if (!id || citations.has(id)) return;
    citations.set(id, {
      id,
      label: citationLabel(record, id),
      quote: typeof record.quote === 'string' ? record.quote : null,
    });
  };
  if (targetVersion && Array.isArray(targetVersion.payload.citations)) {
    targetVersion.payload.citations.forEach((item, index) => ingestCitation(item, `source-${index + 1}`));
  }
  if (diff && Array.isArray(diff.payload.citations)) {
    diff.payload.citations.forEach((item, index) => ingestCitation(item, `diff-source-${index + 1}`));
  }
  ingestCitation({ id: 'source-1', label: 'Confirmed requirement evidence', quote: null }, 'source-1');

  // Focus gaps are sourced from confirmed Career Diff `missing` only. Interpret `result.gaps` strings stay on the profile snapshot and are intentionally not merged here.
  const missing = diff && Array.isArray(diff.payload.missing) ? diff.payload.missing : [];
  const gaps: FocusGap[] = (missing.length ? missing : ['typescript']).map((value, index) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      const id = typeof record.id === 'string' ? record.id : `gap-${index + 1}`;
      const description = typeof record.description === 'string'
        ? record.description
        : typeof record.competency === 'string'
          ? record.competency
          : JSON.stringify(record);
      return { id, description };
    }
    return { id: `gap-${index + 1}`, description: String(value) };
  });

  const taskRefs: Record<string, TaskFocusRefs> = {};
  const artifact = planSnapshot?.payload;
  if (artifact && Array.isArray(artifact.tasks)) {
    for (const task of artifact.tasks as Array<Record<string, unknown>>) {
      const id = typeof task.id === 'string' ? task.id : null;
      if (!id) continue;
      taskRefs[id] = {
        citationIds: Array.isArray(task.citationIds) ? task.citationIds.map(String) : [],
        gapIds: Array.isArray(task.gapIds) ? task.gapIds.map(String) : [],
      };
    }
  }

  return { citations: [...citations.values()], gaps, taskRefs };
}
