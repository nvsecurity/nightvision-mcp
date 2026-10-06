/**
 * Options of `openapi extract` that say where the extracted spec goes.
 */
export interface ExtractTargetOptions {
  target?: string;
  target_id?: string;
  project?: string;
  project_id?: string;
  no_target?: boolean;
  no_upload?: boolean;
}

/**
 * Where a run sends the spec: onto the named target, to NightVision without
 * a target, or nowhere.
 */
export type ExtractUploadMode = 'target' | 'nightvision' | 'none';

/**
 * The upload mode a caller asked for (NV-5668). no_upload: true uploads
 * nothing, as the CLI's --no-upload does beside any other option.
 * no_target: false uploads to the named target. Otherwise the run has no
 * target, except for the former request form: no_target left out, a target
 * named, and no_upload: false.
 */
export function extractUploadMode(options: ExtractTargetOptions): ExtractUploadMode {
  if (options.no_upload === true) return 'none';
  if (options.no_target === false) return 'target';
  if (options.no_target === undefined && options.no_upload === false && (options.target || options.target_id)) {
    return 'target';
  }
  return 'nightvision';
}

/**
 * True when `openapi extract --help` lists the --no-target flag (NV-5668).
 */
export function supportsNoTarget(helpText: string): boolean {
  return /^\s+--no-target\b/m.test(helpText);
}

/**
 * The `openapi extract` arguments that say where the spec goes. A run
 * without a target passes --no-target, which the CLI rejects beside
 * --target, so the target and project are left out; a CLI before 0.19.0,
 * which lacks --no-target, gets --no-upload instead (NV-5668).
 */
export function extractTargetArgs(options: ExtractTargetOptions, noTargetSupported: boolean): string[] {
  switch (extractUploadMode(options)) {
    case 'none':
      return ['--no-upload'];
    case 'nightvision':
      return [noTargetSupported ? '--no-target' : '--no-upload'];
    case 'target': {
      const args: string[] = [];
      if (options.target) args.push('--target', options.target);
      if (options.target_id) args.push('--target-id', options.target_id);
      if (options.project) args.push('--project', options.project);
      if (options.project_id) args.push('--project-id', options.project_id);
      return args;
    }
  }
}
