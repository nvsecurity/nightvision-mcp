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
