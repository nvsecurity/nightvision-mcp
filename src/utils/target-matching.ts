import type { Target } from '../types/index.js';

export type TargetMatch =
  | { status: 'found'; target: Target }
  | { status: 'not-found' }
  | { status: 'ambiguous'; projects: string[] };

/**
 * Resolve a target by name for an operation that must act on exactly one of
 * them. Target names are unique only within a project, so the caller can narrow
 * the match by project name and/or project id. When the name still matches more
 * than one target, returns 'ambiguous' with the candidate project names so the
 * caller can refuse rather than guess (important for destructive operations).
 */
export function matchTargetByName(
  targets: Target[],
  name: string,
  project?: string,
  projectId?: string
): TargetMatch {
  let matches = targets.filter((t) => t.name === name);
  if (project) {
    matches = matches.filter((t) => t.project_name === project);
  }
  if (projectId) {
    matches = matches.filter((t) => t.project_id === projectId);
  }

  if (matches.length > 1) {
    return { status: 'ambiguous', projects: matches.map((m) => m.project_name) };
  }
  if (matches.length === 0) {
    return { status: 'not-found' };
  }
  return { status: 'found', target: matches[0] };
}
