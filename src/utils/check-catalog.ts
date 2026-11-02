/**
 * Pure helpers for translating inclusion-based check selection
 * (e.g. "SQL Injection") into the exclusion lists the CLI expects.
 *
 * The catalog itself is fetched from the API by the service layer; these
 * functions operate on an already-fetched ConfiguredChecks value.
 */

export interface ZapAlert {
  Id: string;
  Alert: string;
  Status: string;
  Risk: string;
  Type: string;
  Link: string;
}

export interface ConfiguredChecks {
  zap: {
    standard: ZapAlert[];
    web: ZapAlert[];
  };
  nuclei: string[];
}

/**
 * Get all ZAP alert IDs from the configured checks.
 */
export function getAllAlertIds(checks: ConfiguredChecks): string[] {
  const standard = checks.zap.standard?.map((a) => a.Id) || [];
  const web = checks.zap.web?.map((a) => a.Id) || [];
  return [...standard, ...web];
}

/**
 * Given check names to include, return the alert IDs to EXCLUDE.
 * Case-insensitive partial matching against alert names.
 */
export function getExclusionIds(
  checks: ConfiguredChecks,
  includeNames: string[]
): { excludeIds: string[]; matchedAlerts: string[] } {
  const lowerNames = includeNames.map((n) => n.toLowerCase());

  const allAlerts = [
    ...(checks.zap.standard || []),
    ...(checks.zap.web || []),
  ];

  const matched: ZapAlert[] = [];
  for (const alert of allAlerts) {
    const alertLower = alert.Alert.toLowerCase();
    if (lowerNames.some((n) => alertLower.includes(n) || n.includes(alertLower))) {
      matched.push(alert);
    }
  }

  const includeIds = new Set(matched.map((a) => a.Id));
  const allIds = getAllAlertIds(checks);
  const excludeIds = allIds.filter((id) => !includeIds.has(id));

  return {
    excludeIds,
    matchedAlerts: matched.map((a) => `${a.Alert} [${a.Id}]`),
  };
}

/**
 * Given nuclei folder names to include, return the folders to EXCLUDE.
 * Case-insensitive partial matching.
 */
export function getNucleiExclusionFolders(
  checks: ConfiguredChecks,
  includeNames: string[]
): { excludeFolders: string[]; matchedFolders: string[] } {
  const lowerNames = includeNames.map((n) => n.toLowerCase());
  const allFolders = checks.nuclei || [];

  const matched = allFolders.filter((folder) => {
    const folderLower = folder.toLowerCase();
    return lowerNames.some((n) => folderLower.includes(n) || n.includes(folderLower));
  });

  const includeSet = new Set(matched);
  const excludeFolders = allFolders.filter((f) => !includeSet.has(f));

  return { excludeFolders, matchedFolders: matched };
}

/**
 * A custom Nuclei template assigned to a target, as the nuclei-templates
 * listing returns it (only the fields the selection needs).
 */
export interface NucleiTemplateRef {
  id: string;
  name: string;
  /** `VALID` when a file exists, `NO_FILE` otherwise. Older APIs omit it. */
  status?: string;
}

/** How one requested value matched a template. */
export interface NucleiTemplateMatch {
  requested: string;
  template: NucleiTemplateRef;
  by: 'id' | 'name' | 'partial-name';
}

export type NucleiTemplateSelection =
  | {
      ok: true;
      run: NucleiTemplateRef[];
      skip: NucleiTemplateRef[];
      matches: NucleiTemplateMatch[];
    }
  | {
      ok: false;
      unmatched: string[];
      ambiguous: Array<{ requested: string; candidates: NucleiTemplateRef[] }>;
    };

/**
 * Given custom template names or ids to include, split the target's assigned
 * templates into the ones to run and the ones to skip (NV-6605).
 *
 * Each value matches by exact id first, then by case-insensitive exact name,
 * then by case-insensitive partial name, where the value must be part of the
 * template name and never the reverse. A value that matches several templates
 * at the same step is ambiguous and is never resolved silently. The selection
 * fails when any value is ambiguous or matches nothing, so a typo cannot make
 * the scan quietly skip a template the user asked for.
 */
export function selectNucleiTemplates(
  assigned: NucleiTemplateRef[],
  requested: string[]
): NucleiTemplateSelection {
  const unmatched: string[] = [];
  const ambiguous: Array<{ requested: string; candidates: NucleiTemplateRef[] }> = [];
  const matches: NucleiTemplateMatch[] = [];

  for (const raw of requested) {
    const value = raw.trim();
    if (!value) {
      unmatched.push(raw);
      continue;
    }
    const lower = value.toLowerCase();

    const byId = assigned.filter((t) => t.id.toLowerCase() === lower);
    if (byId.length > 0) {
      matches.push({ requested: raw, template: byId[0], by: 'id' });
      continue;
    }

    const steps: Array<[NucleiTemplateMatch['by'], NucleiTemplateRef[]]> = [
      ['name', assigned.filter((t) => t.name.toLowerCase() === lower)],
      ['partial-name', assigned.filter((t) => t.name.toLowerCase().includes(lower))],
    ];
    const step = steps.find(([, found]) => found.length > 0);
    if (!step) {
      unmatched.push(raw);
    } else if (step[1].length > 1) {
      ambiguous.push({ requested: raw, candidates: step[1] });
    } else {
      matches.push({ requested: raw, template: step[1][0], by: step[0] });
    }
  }

  if (unmatched.length > 0 || ambiguous.length > 0) {
    return { ok: false, unmatched, ambiguous };
  }

  const runIds = new Set(matches.map((m) => m.template.id));
  return {
    ok: true,
    run: assigned.filter((t) => runIds.has(t.id)),
    skip: assigned.filter((t) => !runIds.has(t.id)),
    matches,
  };
}

/**
 * Format a list of templates as "name (id)" lines for error messages.
 */
export function formatNucleiTemplateList(templates: NucleiTemplateRef[]): string {
  return templates.map((t) => `  - ${t.name} (${t.id})`).join('\n');
}

/**
 * Format all available checks for display.
 */
export function formatCheckList(checks: ConfiguredChecks): string {
  const lines: string[] = [];

  if (checks.zap.standard?.length) {
    lines.push('Standard ZAP Checks:');
    for (const a of checks.zap.standard) {
      lines.push(`  - ${a.Alert} [${a.Id}] (${a.Risk})`);
    }
  }

  if (checks.zap.web?.length) {
    lines.push('\nWeb-Only ZAP Checks:');
    for (const a of checks.zap.web) {
      lines.push(`  - ${a.Alert} [${a.Id}] (${a.Risk})`);
    }
  }

  if (checks.nuclei?.length) {
    lines.push('\nNuclei Folders:');
    for (const folder of checks.nuclei) {
      lines.push(`  - ${folder}`);
    }
  }

  return lines.join('\n');
}
