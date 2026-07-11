import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { existsSync, statSync } from 'fs';
import { mkdir, readFile, unlink } from 'fs/promises';
import path from 'path';
import { nightvisionService } from '../services/index.js';
import { RunAppSecurityScanParamsSchema, type Target } from '../types/index.js';
import { resolveActualOutputFile } from '../utils/discover-output-path.js';
import { detectLanguages, type NightVisionLanguage } from '../utils/language-detect.js';
import { writeManifest } from '../utils/manifest.js';
import { languageOutputPath } from '../utils/output-naming.js';
import { localTargetName } from '../utils/project-target-naming.js';
import { resolveTargetUrl } from '../utils/runtime-detect.js';
import { getRepoMetadata } from '../utils/repo-metadata.js';
import { requireProjectAccess } from '../utils/auth-guard.js';
import { extractScanId } from '../utils/scan-id.js';
import { classifyScanStatus, scanHasFindings } from '../utils/scan-status.js';
import { extractSourceFindings, countSourceLinked, type SourceFinding } from '../utils/sarif-findings.js';
import { matchTargetByName } from '../utils/target-matching.js';
import { jsonText } from '../utils/tool-response.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface ProjectLike {
  id?: string;
  name?: string;
  is_default?: boolean;
}

interface ProjectChoice {
  name: string | null;
  id: string | null;
  source: 'argument' | 'environment' | 'project_id' | 'default_project' | 'single_project' | 'not_found';
  warnings: string[];
}

interface TargetResolution {
  action: 'created' | 'reused' | 'updated';
  target: Target | null;
  raw_output?: unknown;
  warnings: string[];
}

interface WaitResult {
  state: 'succeeded' | 'failed' | 'timeout';
  elapsed_seconds: number;
  last_status: unknown;
}

interface HarnessAppAuth {
  type: 'headers' | 'cookies' | 'playwright_script';
  name?: string;
  description?: string;
  credential_lifetime?: 'stable' | 'session' | 'unknown';
  headers?: Array<{ name: string; value: string }>;
  cookies?: Array<{ name: string; value: string }>;
  script_content?: string;
  script_first_url?: string;
}

function existingDirectory(projectPath: string): boolean {
  try {
    return statSync(projectPath).isDirectory();
  } catch {
    return false;
  }
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function projectsFrom(raw: unknown): ProjectLike[] {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as any;
  if (Array.isArray(obj.results)) return obj.results;
  if (Array.isArray(obj.projects)) return obj.projects;
  return [];
}

function targetsFrom(raw: unknown): Target[] {
  if (Array.isArray(raw)) return raw as Target[];
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as any;
  if (Array.isArray(obj.targets)) return obj.targets as Target[];
  if (Array.isArray(obj.results)) return obj.results as Target[];
  return [];
}

async function findExistingTarget(
  name: string,
  projectName: string,
  projectId: string | null,
  warnings: string[]
): Promise<Target | null> {
  const rawTargets = await nightvisionService.listTargets(false, [projectName], 'json');
  const targets = targetsFrom(parseJson(rawTargets));
  const match = matchTargetByName(targets, name, projectName, projectId || undefined);

  if (match.status === 'ambiguous') {
    throw new Error(`Multiple targets named "${name}" exist in projects: ${match.projects.join(', ')}`);
  }

  if (match.status === 'found') {
    return match.target;
  }

  try {
    const apiMatches = await nightvisionService.findTarget(name);
    const apiTargets = apiMatches.map((target) => ({
      ...target,
      project: target.project_id,
      is_ready_to_scan: true
    })) as Target[];
    const apiMatch = matchTargetByName(apiTargets, name, projectName, projectId || undefined);

    if (apiMatch.status === 'ambiguous') {
      throw new Error(`Multiple targets named "${name}" exist in projects: ${apiMatch.projects.join(', ')}`);
    }

    if (apiMatch.status === 'found') {
      warnings.push('Existing target was found through direct target lookup after target list returned no match.');
      return apiMatch.target;
    }
  } catch (error: any) {
    warnings.push(`Direct target lookup failed: ${error.message}`);
  }

  return null;
}

async function updateExistingTarget(
  existing: Target | null,
  name: string,
  url: string,
  projectName: string,
  projectId: string | null,
  specFile: string | null,
  warnings: string[]
): Promise<TargetResolution> {
  try {
    const rawUpdate = await nightvisionService.updateTarget(
      name,
      {
        project: projectName,
        project_id: projectId || undefined,
        url,
        spec_file: specFile || undefined
      },
      'json'
    );
    return {
      action: 'updated',
      target: existing,
      raw_output: parseJson(rawUpdate),
      warnings
    };
  } catch (error: any) {
    warnings.push(`Existing target was reused, but updating its URL/spec failed: ${error.message}`);
    return {
      action: 'reused',
      target: existing,
      warnings
    };
  }
}

async function chooseProject(
  requestedName?: string,
  requestedId?: string,
  allowCliLookup = true
): Promise<ProjectChoice> {
  const envProject = process.env.NIGHTVISION_DEFAULT_PROJECT;

  if (requestedName) {
    return { name: requestedName, id: requestedId || null, source: 'argument', warnings: [] };
  }

  if (envProject) {
    return { name: envProject, id: requestedId || null, source: 'environment', warnings: [] };
  }

  if (!allowCliLookup) {
    return {
      name: null,
      id: requestedId || null,
      source: 'not_found',
      warnings: ['No NightVision project was supplied and project lookup was skipped because authentication is not configured.']
    };
  }

  try {
    const raw = await nightvisionService.executeCommand(['project', 'list'], 'json');
    const projects = projectsFrom(parseJson(raw)).filter((project) => project.name);
    const byId = requestedId ? projects.find((project) => project.id === requestedId) : undefined;
    if (byId?.name) {
      return { name: byId.name, id: byId.id || requestedId || null, source: 'project_id', warnings: [] };
    }

    const defaultProject = projects.find((project) => project.is_default);
    if (defaultProject?.name) {
      return { name: defaultProject.name, id: defaultProject.id || null, source: 'default_project', warnings: [] };
    }

    if (projects.length === 1 && projects[0].name) {
      return { name: projects[0].name, id: projects[0].id || null, source: 'single_project', warnings: [] };
    }

    return {
      name: null,
      id: requestedId || null,
      source: 'not_found',
      warnings: ['Multiple NightVision projects are available. Provide nightvision_project or set NIGHTVISION_DEFAULT_PROJECT.']
    };
  } catch (error: any) {
    return {
      name: null,
      id: requestedId || null,
      source: 'not_found',
      warnings: [`Could not list NightVision projects: ${error.message}`]
    };
  }
}

function actualSpecFiles(outputBase: string, languages: NightVisionLanguage[]): string[] {
  const candidates = [
    resolveActualOutputFile(outputBase, existsSync),
    ...languages.map((language) => resolveActualOutputFile(languageOutputPath(outputBase, language), existsSync))
  ];
  return [...new Set(candidates.filter((candidate): candidate is string => !!candidate))];
}

async function removeIfExists(file: string): Promise<void> {
  try {
    await unlink(file);
  } catch (error: any) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }
}

async function runApiDiscovery(projectPath: string, languages: NightVisionLanguage[]) {
  const outputBase = path.join(projectPath, '.nightvision', 'openapi.yml');

  if (languages.length === 0) {
    return {
      attempted: false,
      status: 'skipped' as const,
      spec_files: [] as string[],
      attached_spec_file: null as string | null,
      raw_output: null as unknown,
      warning: 'No supported source language was detected, so API Discovery was skipped.'
    };
  }

  try {
    await mkdir(path.dirname(outputBase), { recursive: true });
    await Promise.all([
      outputBase,
      ...languages.map((language) => languageOutputPath(outputBase, language))
    ].map(removeIfExists));

    const raw = await nightvisionService.discoverApi(
      [projectPath],
      {
        lang: languages.length === 1 ? languages[0] : languages,
        output: outputBase,
        no_upload: true
      },
      'text',
      projectPath
    );
    const specFiles = actualSpecFiles(outputBase, languages);

    return {
      attempted: true,
      status: specFiles.length > 0 ? 'success' as const : 'no_spec' as const,
      spec_files: specFiles,
      attached_spec_file: specFiles[0] || null,
      raw_output: raw,
      warning: specFiles.length > 1
        ? 'Multiple OpenAPI specs were generated. The first spec is attached to the NightVision target.'
        : specFiles.length === 0
          ? 'API Discovery completed but no OpenAPI spec file was produced.'
          : null
    };
  } catch (error: any) {
    return {
      attempted: true,
      status: 'failed' as const,
      spec_files: [] as string[],
      attached_spec_file: null as string | null,
      raw_output: null as unknown,
      warning: `API Discovery failed, so the scan will run as a WEB target: ${error.message}`
    };
  }
}

async function ensureTarget(
  name: string,
  url: string,
  projectName: string,
  projectId: string | null,
  specFile: string | null
): Promise<TargetResolution> {
  const warnings: string[] = [];

  const existing = await findExistingTarget(name, projectName, projectId, warnings);
  if (existing) {
    return updateExistingTarget(existing, name, url, projectName, projectId, specFile, warnings);
  }

  let rawCreate: string;
  try {
    rawCreate = await nightvisionService.createTarget(
      name,
      url,
      {
        project: projectName,
        project_id: projectId || undefined,
        type: specFile ? 'API' : 'WEB',
        spec_file: specFile || undefined
      },
      'json'
    );
  } catch (error: any) {
    if (!/already exists/i.test(error.message)) {
      throw error;
    }

    warnings.push('Target already exists in NightVision, so the harness will reuse and update it.');
    const existingAfterCreate = await findExistingTarget(name, projectName, projectId, warnings);
    return updateExistingTarget(existingAfterCreate, name, url, projectName, projectId, specFile, warnings);
  }

  return {
    action: 'created',
    target: parseJson(rawCreate) as Target,
    raw_output: parseJson(rawCreate),
    warnings
  };
}

function credentialName(targetName: string, requested?: string): string {
  return requested || `${targetName}-auth`;
}

function sanitizedCredential(raw: any, fallbackName: string, type: HarnessAppAuth['type']): Record<string, unknown> {
  return {
    id: raw?.id || null,
    name: raw?.name || fallbackName,
    type: raw?.type || type,
    project: raw?.project || raw?.project_name || null
  };
}

async function createHarnessAppAuth(
  auth: HarnessAppAuth,
  project: string,
  targetName: string
): Promise<{ auth?: string; auth_id?: string; created: Record<string, unknown> }> {
  const name = credentialName(targetName, auth.name);
  const description = auth.description || `Created by NightVision MCP app security scan harness for ${targetName}`;
  let created: any;

  if (auth.type === 'headers') {
    if (!auth.headers || auth.headers.length === 0) {
      throw new Error('app_auth.headers is required when app_auth.type is headers.');
    }
    created = await nightvisionService.createHeaderCredential({
      name,
      headers: auth.headers,
      project,
      description
    });
  } else if (auth.type === 'cookies') {
    if (!auth.cookies || auth.cookies.length === 0) {
      throw new Error('app_auth.cookies is required when app_auth.type is cookies.');
    }
    created = await nightvisionService.createCookieCredential({
      name,
      cookie: auth.cookies,
      project,
      description
    });
  } else if (auth.type === 'playwright_script') {
    if (!auth.script_content) {
      throw new Error('app_auth.script_content is required when app_auth.type is playwright_script.');
    }
    created = await nightvisionService.createScriptCredential({
      name,
      script_content: auth.script_content,
      script_first_url: auth.script_first_url,
      project,
      description
    });
  } else {
    throw new Error(`Unsupported app_auth.type: ${(auth as any).type}`);
  }

  return {
    auth: created?.name || name,
    auth_id: created?.id || undefined,
    created: sanitizedCredential(created, name, auth.type)
  };
}

async function waitForScan(scanId: string, timeoutSeconds: number): Promise<WaitResult> {
  const startTime = Date.now();
  const timeoutMs = Math.max(0, timeoutSeconds * 1000);
  const pollMs = 15_000;
  let lastStatus: unknown = null;

  while (Date.now() - startTime <= timeoutMs) {
    // A single transient poll failure (5xx/ECONNRESET during a long scan) must
    // NOT abort the whole run and lose the scan handle. Treat a poll error like
    // an in-progress status: record it and keep polling until a terminal status
    // or the timeout, so the caller still gets scan_id + manifest.
    let parsed: unknown;
    try {
      parsed = parseJson(await nightvisionService.getScanStatus(scanId, 'json'));
    } catch (error: any) {
      parsed = { poll_error: error?.message || String(error) };
    }
    lastStatus = parsed;
    const state = classifyScanStatus(parsed);
    const elapsedSeconds = Math.round((Date.now() - startTime) / 1000);

    if (state === 'succeeded') {
      return { state: 'succeeded', elapsed_seconds: elapsedSeconds, last_status: parsed };
    }

    if (state === 'failed') {
      return { state: 'failed', elapsed_seconds: elapsedSeconds, last_status: parsed };
    }

    const remainingMs = timeoutMs - (Date.now() - startTime);
    if (remainingMs <= 0) {
      break;
    }

    await sleep(Math.min(pollMs, remainingMs));
  }

  return {
    state: 'timeout',
    elapsed_seconds: Math.round((Date.now() - startTime) / 1000),
    last_status: lastStatus
  };
}

/**
 * Register the guided app security scan harness.
 */
export function registerHarnessTools(server: McpServer): void {
  server.tool(
    'run-app-security-scan',
    RunAppSecurityScanParamsSchema,
    async (args, _extra) => {
      const startedAt = new Date().toISOString();
      const projectPath = path.resolve(args.project_path || process.cwd());
      const warnings: string[] = [];
      const blockers: string[] = [];

      try {
        if (!existingDirectory(projectPath)) {
          return jsonText({
            ok: false,
            status: 'blocked',
            error: {
              code: 'PROJECT_PATH_NOT_FOUND',
              message: `Project path is not a readable directory: ${projectPath}`
            },
            blockers: ['project_path_not_found']
          });
        }

        const repo = getRepoMetadata(projectPath);
        const language = detectLanguages(projectPath);
        const runtime = await resolveTargetUrl(args.target_url);
        const appName = args.app_name || repo.repo_name;
        const targetName = args.target_name || localTargetName(repo.repo_name, appName);
        const tokenPresent = !!nightvisionService.getToken();
        const authResult = tokenPresent
          ? await nightvisionService.getAuthenticatedUserResult()
          : { status: 'unauthenticated' as const };
        const authenticatedUser = authResult.status === 'authenticated' ? authResult.user : null;
        const authenticated = !!authenticatedUser;
        const projectChoice = await chooseProject(
          args.nightvision_project,
          args.nightvision_project_id,
          authenticated
        );
        warnings.push(...projectChoice.warnings);

        if (!tokenPresent) {
          blockers.push('not_authenticated');
        } else if (authResult.status === 'error') {
          // Connectivity/service problem, not a bad token. Flag it distinctly so
          // the agent retries rather than telling the user to re-authenticate.
          blockers.push('nightvision_api_unavailable');
          warnings.push(`Could not validate NightVision auth because the API was unreachable: ${authResult.message}`);
        } else if (!authenticated) {
          blockers.push('invalid_or_expired_token');
        }

        if (!args.target_url) {
          blockers.push('target_url_required');
          warnings.push('Pass target_url set to the running app URL (for example http://127.0.0.1:8080). The agent knows this; the harness does not guess it.');
        } else if (!runtime.target_url) {
          blockers.push('runtime_url_not_reachable');
        }

        if (!projectChoice.name) {
          blockers.push('nightvision_project_required');
        }

        if (args.no_auth && args.app_auth) {
          blockers.push('target_app_auth_conflict');
        }

        const envAuthId = process.env.NIGHTVISION_CREDS_ID;
        const requestedAppAuth = args.app_auth as HarnessAppAuth | undefined;
        if (
          requestedAppAuth &&
          (requestedAppAuth.type === 'headers' || requestedAppAuth.type === 'cookies') &&
          requestedAppAuth.credential_lifetime !== 'stable'
        ) {
          blockers.push('target_app_auth_requires_stable_credential');
          warnings.push('Header/cookie target app auth must be a stable credential. Use playwright_script for username/password login flows or expiring session cookies/tokens.');
        }
        const scanAuth = args.no_auth || requestedAppAuth ? null : args.auth || null;
        const scanAuthId = args.no_auth || requestedAppAuth ? null : args.auth_id || envAuthId || null;
        const appAuth: Record<string, unknown> = {
          auth: scanAuth,
          auth_id: scanAuthId,
          no_auth: requestedAppAuth ? false : args.no_auth ?? (!scanAuth && !scanAuthId),
          create: requestedAppAuth ? {
            type: requestedAppAuth.type,
            name: credentialName(targetName, requestedAppAuth.name),
            credential_lifetime: requestedAppAuth.credential_lifetime || 'unknown',
            planned: true
          } : null
        };

        if (appAuth.no_auth) {
          warnings.push('No target app auth was supplied. The DAST scan will run unauthenticated.');
        }

        if (authenticated && projectChoice.name) {
          const projectAccess = await requireProjectAccess({
            project: projectChoice.name,
            project_id: projectChoice.id,
            action: 'running a guided app security scan'
          });
          if (!projectAccess.ok) {
            blockers.push('project_access_denied');
            warnings.push(`Could not verify access to NightVision project "${projectChoice.name}".`);
          } else if (!projectChoice.id && projectAccess.project?.id) {
            projectChoice.id = projectAccess.project.id;
          }
        }

        const baseManifest = {
          generated_at: new Date().toISOString(),
          workflow: 'run-app-security-scan',
          started_at: startedAt,
          dry_run: !!args.dry_run,
          repo,
          app: {
            app_name: appName,
            project_path: projectPath,
            languages: language.languages,
            frameworks: language.frameworks,
            package_manager: language.package_manager,
            target_url: runtime.target_url,
            checked_urls: runtime.checked_urls
          },
          nightvision: {
            authenticated,
            user: authenticatedUser ? {
              id: authenticatedUser.id,
              email: authenticatedUser.email,
              name: authenticatedUser.name,
              organization: authenticatedUser.organization,
              roles: authenticatedUser.roles
            } : null,
            project_name: projectChoice.name,
            project_id: projectChoice.id,
            project_source: projectChoice.source,
            target_name: targetName,
            app_auth: appAuth,
            force_private_scan: !!args.force_private_scan
          },
          blockers,
          warnings
        };

        if (args.dry_run || blockers.length > 0) {
          const manifestPath = await writeManifest(projectPath, {
            ...baseManifest,
            completed_at: new Date().toISOString()
          });

          if (args.dry_run) {
            return jsonText({
              ok: true,
              status: blockers.length > 0 || warnings.length > 0 ? 'partial' : 'success',
              data: {
                ...baseManifest,
                manifest_path: manifestPath
              },
              warnings
            });
          }

          return jsonText({
            ok: false,
            status: 'blocked',
            error: {
              code: 'APP_SCAN_PREFLIGHT_BLOCKED',
              message: 'NightVision app security scan cannot start until preflight blockers are resolved.',
              details: {
                ...baseManifest,
                manifest_path: manifestPath
              }
            },
            blockers,
            warnings
          });
        }

        const discovery = await runApiDiscovery(projectPath, language.languages);
        if (discovery.warning) {
          warnings.push(discovery.warning);
        }

        if (requestedAppAuth) {
          const createdAuth = await createHarnessAppAuth(
            requestedAppAuth,
            projectChoice.id || projectChoice.name!,
            targetName
          );
          appAuth.auth = createdAuth.auth || null;
          appAuth.auth_id = createdAuth.auth_id || null;
          appAuth.no_auth = false;
          appAuth.create = {
            ...(appAuth.create as Record<string, unknown>),
            planned: false,
            created: createdAuth.created
          };
        }

        const target = await ensureTarget(
          targetName,
          runtime.target_url!,
          projectChoice.name!,
          projectChoice.id,
          discovery.attached_spec_file
        );
        warnings.push(...target.warnings);

        const scanRaw = await nightvisionService.startManagedScan(
          targetName,
          {
            auth: typeof appAuth.auth === 'string' ? appAuth.auth : undefined,
            auth_id: typeof appAuth.auth_id === 'string' ? appAuth.auth_id : undefined,
            no_auth: !!appAuth.no_auth,
            project: projectChoice.name!,
            project_id: projectChoice.id || undefined,
            force_private_scan: !!args.force_private_scan
          },
          'json'
        );
        const scanId = extractScanId(scanRaw);

        if (!scanId) {
          const manifestPath = await writeManifest(projectPath, {
            ...baseManifest,
            api_discovery: discovery,
            target,
            scan: {
              raw_output: parseJson(scanRaw)
            },
            completed_at: new Date().toISOString()
          });

          return jsonText({
            ok: false,
            status: 'blocked',
            error: {
              code: 'SCAN_ID_NOT_FOUND',
              message: 'NightVision started a scan but the CLI output did not include a scan ID.',
              details: {
                raw_output: parseJson(scanRaw),
                manifest_path: manifestPath
              }
            },
            blockers: ['scan_id_not_found'],
            warnings
          });
        }

        if (!args.wait) {
          warnings.push('DAST scans commonly run longer than 10 minutes. Keep the MCP server running so any local/private scan relay stays alive, then poll with get-scan-status or wait-for-scan and export results after completion.');

          const manifestPath = await writeManifest(projectPath, {
            ...baseManifest,
            api_discovery: discovery,
            target,
            scan: {
              scan_id: scanId,
              raw_output: parseJson(scanRaw),
              status: 'started'
            }
          });

          return jsonText({
            ok: true,
            status: 'running',
            data: {
              ...baseManifest,
              api_discovery: discovery,
              target,
              scan: {
                scan_id: scanId,
                raw_output: parseJson(scanRaw),
                status: 'started'
              },
              manifest_path: manifestPath
            },
            warnings
          });
        }

        // Persist the scan id BEFORE the (potentially hour-long) wait so the
        // handle survives even if the wait or a later export throws. The manifest
        // is rewritten with full results once the scan reaches a terminal status.
        await writeManifest(projectPath, {
          ...baseManifest,
          api_discovery: discovery,
          target,
          scan: {
            scan_id: scanId,
            raw_output: parseJson(scanRaw),
            status: 'started'
          }
        });

        const waitResult = await waitForScan(scanId, args.timeout_seconds);
        let sarifPath: string | null = null;
        let sarifRaw: unknown = null;
        let sourceFindings: SourceFinding[] = [];

        if (waitResult.state !== 'timeout') {
          sarifPath = path.join(projectPath, '.nightvision', `nightvision-${scanId}.sarif`);
          try {
            const rawExport = await nightvisionService.exportSarif(
              scanId,
              sarifPath,
              // Attach the discovered spec so findings carry a source file:line.
              { swagger_file: discovery.attached_spec_file || undefined },
              'json'
            );
            sarifRaw = parseJson(rawExport);
            sourceFindings = extractSourceFindings(JSON.parse(await readFile(sarifPath, 'utf8')));
          } catch (error: any) {
            warnings.push(`Scan completed but SARIF export failed: ${error.message}`);
            sarifPath = null;
          }
        }

        const hasFindings = scanHasFindings(waitResult.last_status);
        if (waitResult.state === 'failed' && hasFindings) {
          warnings.push('Scan reached a failed terminal status but produced findings. Exported available results and marked this run partial.');
        }

        const manifestPath = await writeManifest(projectPath, {
          ...baseManifest,
          api_discovery: discovery,
          target,
          scan: {
            scan_id: scanId,
            raw_output: parseJson(scanRaw),
            wait: waitResult,
            has_findings: hasFindings,
            sarif_path: sarifPath,
            sarif_raw_output: sarifRaw,
            source_linked_count: countSourceLinked(sourceFindings),
            source_findings: sourceFindings
          },
          completed_at: new Date().toISOString(),
          warnings
        });

        if (waitResult.state === 'failed' && !hasFindings) {
          return jsonText({
            ok: false,
            status: 'blocked',
            error: {
              code: 'SCAN_FAILED',
              message: 'NightVision scan reached an unsuccessful terminal status.',
              details: {
                scan_id: scanId,
                wait: waitResult,
                sarif_path: sarifPath,
                manifest_path: manifestPath
              }
            },
            blockers: ['scan_failed'],
            warnings
          });
        }

        return jsonText({
          ok: true,
          status: waitResult.state === 'timeout' || waitResult.state === 'failed' ? 'partial' : warnings.length > 0 ? 'partial' : 'success',
          data: {
            ...baseManifest,
            api_discovery: discovery,
            target,
            scan: {
              scan_id: scanId,
              raw_output: parseJson(scanRaw),
              wait: waitResult,
              has_findings: hasFindings,
              sarif_path: sarifPath,
              sarif_raw_output: sarifRaw
            },
            manifest_path: manifestPath,
            warnings
          },
          warnings
        });
      } catch (error: any) {
        return jsonText({
          ok: false,
          status: 'error',
          error: {
            code: 'RUN_APP_SECURITY_SCAN_FAILED',
            message: `Failed to run NightVision app security scan: ${error.message}`
          },
          warnings
        });
      }
    }
  );
}
