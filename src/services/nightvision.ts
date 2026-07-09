import { matchTargetByName } from '../utils/target-matching.js';
import type { Target } from '../types/index.js';
import { ApiClient } from './api-client.js';
import { AuthService } from './auth-service.js';
import { TargetService } from './target-service.js';
import { ScanService } from './scan-service.js';
import { NucleiService } from './nuclei-service.js';
import { TrafficService } from './traffic-service.js';
import { ApiDiscoveryService } from './api-discovery-service.js';
import { IssueService } from './issue-service.js';

export type { OutputFormat } from './api-client.js';

/**
 * Facade over the per-domain NightVision services. Preserves the historical
 * public API of the monolithic service: every method the tools call is exposed
 * here and delegated to the relevant domain service. The shared {@link ApiClient}
 * carries the auth token and low-level request/exec primitives.
 */
export class NightVisionService {
  private client = new ApiClient();

  private auth = new AuthService(this.client);
  private targets = new TargetService(this.client);
  // ScanService resolves target/project names through this facade so the
  // resolution methods stay interceptable in the same way as before.
  private scans = new ScanService(this.client, this);
  private nuclei = new NucleiService(this.client);
  private traffic = new TrafficService(this.client);
  private apiDiscovery = new ApiDiscoveryService(this.client);
  private issues = new IssueService(this.client);

  // --- Core / ApiClient ---

  setToken(token: string | null): void {
    this.client.setToken(token);
  }

  getToken(): string | null {
    return this.client.getToken();
  }

  executeCommand(...a: Parameters<ApiClient['executeCommand']>): Promise<string> {
    return this.client.executeCommand(...a);
  }

  isInstalled(): Promise<boolean> {
    return this.client.isInstalled();
  }

  getCliVersion(): Promise<string | null> {
    return this.client.getCliVersion();
  }

  getProjectByName(projectName: string): Promise<any> {
    return this.client.getProjectByName(projectName);
  }

  // --- Auth / Credentials ---

  createToken(...a: Parameters<AuthService['createToken']>) {
    return this.auth.createToken(...a);
  }

  verifyProductionAuth(...a: Parameters<AuthService['verifyProductionAuth']>) {
    return this.auth.verifyProductionAuth(...a);
  }

  ensureProductionAuth(...a: Parameters<AuthService['ensureProductionAuth']>) {
    return this.auth.ensureProductionAuth(...a);
  }

  createUserPassCredential(...a: Parameters<AuthService['createUserPassCredential']>) {
    return this.auth.createUserPassCredential(...a);
  }

  createHeaderCredential(...a: Parameters<AuthService['createHeaderCredential']>) {
    return this.auth.createHeaderCredential(...a);
  }

  createCookieCredential(...a: Parameters<AuthService['createCookieCredential']>) {
    return this.auth.createCookieCredential(...a);
  }

  assignCredentialToTargets(...a: Parameters<AuthService['assignCredentialToTargets']>) {
    return this.auth.assignCredentialToTargets(...a);
  }

  createScriptCredential(...a: Parameters<AuthService['createScriptCredential']>) {
    return this.auth.createScriptCredential(...a);
  }

  getCredential(...a: Parameters<AuthService['getCredential']>) {
    return this.auth.getCredential(...a);
  }

  getCredentialByName(...a: Parameters<AuthService['getCredentialByName']>) {
    return this.auth.getCredentialByName(...a);
  }

  listCredentials(...a: Parameters<AuthService['listCredentials']>) {
    return this.auth.listCredentials(...a);
  }

  updateScriptCredential(...a: Parameters<AuthService['updateScriptCredential']>) {
    return this.auth.updateScriptCredential(...a);
  }

  // --- Targets ---

  listTargets(...a: Parameters<TargetService['listTargets']>) {
    return this.targets.listTargets(...a);
  }

  createTarget(...a: Parameters<TargetService['createTarget']>) {
    return this.targets.createTarget(...a);
  }

  deleteTarget(...a: Parameters<TargetService['deleteTarget']>) {
    return this.targets.deleteTarget(...a);
  }

  findTarget(...a: Parameters<TargetService['findTarget']>) {
    return this.targets.findTarget(...a);
  }

  listAdditionalPaths(...a: Parameters<TargetService['listAdditionalPaths']>) {
    return this.targets.listAdditionalPaths(...a);
  }

  createAdditionalPaths(...a: Parameters<TargetService['createAdditionalPaths']>) {
    return this.targets.createAdditionalPaths(...a);
  }

  /**
   * Resolve a target name to its id for scan filtering. Target names are unique
   * only within a project, so a name shared across projects must be narrowed by
   * project name or id; an unresolvable or ambiguous name is an error rather
   * than a silently broadened result. Implemented on the facade so it calls the
   * facade's own {@link listTargets}, keeping resolution interceptable.
   * @param name Target name to resolve
   * @param project Optional project name to disambiguate the target
   * @param projectId Optional project UUID to disambiguate the target
   * @returns The matching target's UUID
   */
  async resolveTargetId(
    name: string,
    project?: string,
    projectId?: string
  ): Promise<string> {
    const allTargets = await this.listTargets(true, undefined, 'json');
    let targets: Target[];
    try {
      targets = JSON.parse(allTargets);
    } catch {
      throw new Error(`Could not parse the target list while resolving target "${name}".`);
    }
    const match = matchTargetByName(targets, name, project, projectId);
    if (match.status === 'ambiguous') {
      throw new Error(
        `Multiple targets named "${name}" exist (in projects: ${match.projects.join(', ')}). ` +
        `Specify 'project' or 'project_id' to identify which one.`
      );
    }
    if (match.status === 'not-found') {
      throw new Error(`No target found with name: ${name}`);
    }
    return match.target.id;
  }

  // --- Scans ---

  startScan(...a: Parameters<ScanService['startScan']>) {
    return this.scans.startScan(...a);
  }

  listScans(...a: Parameters<ScanService['listScans']>) {
    return this.scans.listScans(...a);
  }

  getScanStatus(...a: Parameters<ScanService['getScanStatus']>) {
    return this.scans.getScanStatus(...a);
  }

  getScanChecks(...a: Parameters<ScanService['getScanChecks']>) {
    return this.scans.getScanChecks(...a);
  }

  getScanPaths(...a: Parameters<ScanService['getScanPaths']>) {
    return this.scans.getScanPaths(...a);
  }

  getConfiguredChecks(...a: Parameters<ScanService['getConfiguredChecks']>) {
    return this.scans.getConfiguredChecks(...a);
  }

  // --- Nuclei ---

  uploadNucleiTemplate(...a: Parameters<NucleiService['uploadNucleiTemplate']>) {
    return this.nuclei.uploadNucleiTemplate(...a);
  }

  createNucleiTemplate(...a: Parameters<NucleiService['createNucleiTemplate']>) {
    return this.nuclei.createNucleiTemplate(...a);
  }

  listNucleiTemplates(...a: Parameters<NucleiService['listNucleiTemplates']>) {
    return this.nuclei.listNucleiTemplates(...a);
  }

  assignNucleiTemplate(...a: Parameters<NucleiService['assignNucleiTemplate']>) {
    return this.nuclei.assignNucleiTemplate(...a);
  }

  // --- Traffic ---

  recordTraffic(...a: Parameters<TrafficService['recordTraffic']>) {
    return this.traffic.recordTraffic(...a);
  }

  listTraffic(...a: Parameters<TrafficService['listTraffic']>) {
    return this.traffic.listTraffic(...a);
  }

  downloadTraffic(...a: Parameters<TrafficService['downloadTraffic']>) {
    return this.traffic.downloadTraffic(...a);
  }

  // --- API discovery ---

  discoverApi(...a: Parameters<ApiDiscoveryService['discoverApi']>) {
    return this.apiDiscovery.discoverApi(...a);
  }

  // --- Issues / Findings ---

  listIssues(...a: Parameters<IssueService['listIssues']>) {
    return this.issues.listIssues(...a);
  }

  getIssueDetails(...a: Parameters<IssueService['getIssueDetails']>) {
    return this.issues.getIssueDetails(...a);
  }

  getIssueKindStats(...a: Parameters<IssueService['getIssueKindStats']>) {
    return this.issues.getIssueKindStats(...a);
  }

  getVulnerablePaths(...a: Parameters<IssueService['getVulnerablePaths']>) {
    return this.issues.getVulnerablePaths(...a);
  }

  getIssueOccurrences(...a: Parameters<IssueService['getIssueOccurrences']>) {
    return this.issues.getIssueOccurrences(...a);
  }
}

// Export a singleton instance
export default new NightVisionService();
