import { z } from 'zod';

/**
 * Common MCP tool response structure
 */
export interface McpResponse {
  [key: string]: unknown;
  content: Array<{
    type: "text";
    text: string;
  }>;
  isError?: boolean;
}

/**
 * Authentication tool parameters schema
 */
export const AuthenticateParamsSchema = {
  token: z.string().optional().describe("NightVision API token to use for authentication"),
  create_new: z.boolean().optional().describe("Create a new token instead of using an existing one"),
  expiry_date: z.string().optional().describe("Expiry date for new token in format YYYY-MM-DD")
};

/**
 * List targets tool parameters schema
 */
export const ListTargetsParamsSchema = {
  all: z.boolean().optional().describe("Specify to get targets against all projects"),
  projects: z.array(z.string()).optional().describe("Project name(s) to scope the target list to. IMPORTANT: without this (and without `all`), the list is NOT project-scoped. Target names are unique only within a project, so pass the project name here to avoid matching a same-named target in another project."),
  format: z.enum(["text", "json", "table"]).optional().default("json").describe("Format of command output")
};

/**
 * Get target details tool parameters schema
 */
export const GetTargetDetailsParamsSchema = {
  name: z.string().describe("Name of the target to get details for"),
  project: z.string().optional().describe("Project Name of the target (disambiguates a name shared across projects)"),
  project_id: z.string().uuid().optional().describe("Project UUID of the target (disambiguates a name shared across projects)")
};

/**
 * Create target tool parameters schema
 */
export const CreateTargetParamsSchema = {
  name: z.string().describe("Name of the target to create"),
  url: z.string().describe("URL of the target"),
  project: z.string().describe("Project Name of the target (required)"),
  project_id: z.string().uuid().optional().describe("Project UUID of the target"),
  type: z.enum(["API", "WEB"]).optional().default("WEB").describe("Type of the target (API or WEB)"),
  spec_file: z.string().optional().describe("Path to a swagger specification / Postman collection file (for API)"),
  spec_url: z.string().optional().describe("URL to a swagger specification / Postman collection (for API)"),
  exclude_url: z.array(z.string()).optional().describe("URL regex pattern to exclude"),
  exclude_xpath: z.array(z.string()).optional().describe("XPath expression to exclude"),
  format: z.enum(["text", "json", "table"]).optional().default("json").describe("Format of command output")
};

/**
 * Delete target tool parameters schema
 */
export const DeleteTargetParamsSchema = {
  name: z.string().describe("Name of the target to delete"),
  project: z.string().optional().describe("Project Name of the target (disambiguates a name shared across projects)"),
  project_id: z.string().uuid().optional().describe("Project UUID of the target (disambiguates a name shared across projects)"),
  format: z.enum(["text", "json", "table"]).optional().default("json").describe("Format of command output")
};

/**
 * Start scan tool parameters schema
 */
export const StartScanParamsSchema = {
  target_name: z.string().describe("Name of the target to scan"),
  auth: z.string().optional().describe("Authentication name to execute an authenticated scan"),
  auth_id: z.string().uuid().optional().describe("Authentication UUID for scan authentication"),
  no_auth: z.boolean().optional().describe("Set this flag to indicate not to include auth to the scan"),
  project: z.string().optional().describe("Project Name of the target to scan"),
  project_id: z.string().uuid().optional().describe("Project UUID of the target to scan"),
  force_private_scan: z.boolean().optional().default(false).describe("Force the CLI Smart Proxy/private scan path only when automatic private-scan detection needs an override"),
  run_only_zap_checks: z.array(z.string()).optional()
    .describe("Run ONLY these ZAP vulnerability checks by name (e.g. ['SQL Injection']). Use list-check-categories to see available names. All other ZAP checks are disabled."),
  run_only_nuclei_folders: z.array(z.string()).optional()
    .describe("Run ONLY these Nuclei template folders by name. Use list-check-categories to see available folders. All other Nuclei folders are disabled.")
  // Note: start-scan always returns structured JSON, so no output-format param.
};

/**
 * List check categories tool parameters schema
 */
export const ListCheckCategoriesParamsSchema = {};

/**
 * List scans tool parameters schema
 */
export const ListScansParamsSchema = {
  target: z.string().optional().describe("Filter scans by target name"),
  project: z.string().optional().describe("Filter scans by project name"),
  project_id: z.string().uuid().optional().describe("Filter scans by project UUID"),
  limit: z.number().optional().describe("Maximum number of scans to return"),
  status: z.enum(["running", "finished", "failed", "all"]).optional().default("all").describe("Filter scans by status: running, finished (any completed state), failed, or all"),
  format: z.enum(["text", "json", "table"]).optional().default("json").describe("Format of command output")
};

/**
 * Get scan status tool parameters schema
 */
export const GetScanStatusParamsSchema = {
  scan_id: z.string().optional().describe("ID of the scan to get status for"),
  target_name: z.string().optional().describe("Name of the target to get the latest scan status for"),
  project: z.string().optional().describe("Project name to filter by when using target_name"),
  format: z.enum(["text", "json", "table"]).optional().default("json").describe("Format of command output")
};

/**
 * Wait for scan tool parameters schema
 */
export const WaitForScanParamsSchema = {
  scan_id: z.string().describe("ID of the scan to wait for"),
  timeout_seconds: z.number().optional().default(3600).describe("Maximum seconds to wait for a terminal scan status. DAST scans commonly run longer than 10 minutes."),
  poll_interval_seconds: z.number().optional().default(30).describe("Seconds to wait between status checks"),
  format: z.enum(["json"]).optional().default("json").describe("Format of command output")
};

/**
 * Managed scan process status tool parameters schema
 */
export const ManagedScanProcessParamsSchema = {
  scan_id: z.string().describe("ID of the managed scan process to inspect or cancel"),
  format: z.enum(["json"]).optional().default("json").describe("Format of command output")
};

/**
 * Get scan checks (vulnerabilities) tool parameters schema
 */
export const GetScanChecksParamsSchema = {
  scan_id: z.string().describe("ID of the scan to get vulnerability checks for"),
  page: z.number().optional().describe("Page number for pagination"),
  page_size: z.number().optional().describe("Number of items per page"),
  name: z.string().optional().describe("Filter vulnerability checks by name"),
  check_kind: z.string().optional().describe("Filter vulnerability checks by specific kind"),
  severity: z.array(z.enum(["critical", "high", "medium", "low", "info", "unknown", "unspecified"])).optional().describe("Filter vulnerabilities by severity levels (defaults to critical, high, medium, low)"),
  status: z.array(z.number().refine(val => [0, 1, 2, 3].includes(val), {
    message: "Status must be one of: 0, 1, 2, 3"
  })).optional().describe("Filter vulnerabilities by status codes: 0, 1, 2, 3 (defaults to open status 0)"),
  format: z.enum(["text", "json", "table"]).optional().default("json").describe("Format of command output")
};

/**
 * Summarize scan findings tool parameters schema
 */
export const SummarizeScanFindingsParamsSchema = {
  scan_id: z.string().describe("ID of the scan to summarize findings for"),
  severity: z.array(z.enum(["critical", "high", "medium", "low", "info", "unknown", "unspecified"])).optional().describe("Severity levels to include (defaults to critical, high, medium, low)"),
  status: z.array(z.number().refine(val => [0, 1, 2, 3].includes(val), {
    message: "Status must be one of: 0, 1, 2, 3"
  })).optional().describe("Status codes to include (defaults to open status 0)"),
  page_size: z.number().optional().default(100).describe("Number of scan checks to fetch before summarizing"),
  limit: z.number().optional().default(20).describe("Maximum number of findings to include in the summary"),
  format: z.enum(["json"]).optional().default("json").describe("Format of command output")
};

/**
 * Export SARIF tool parameters schema
 */
export const ExportSarifParamsSchema = {
  scan_id: z.string().describe("ID of the scan to export to SARIF"),
  project_path: z.string().optional().describe("App SOURCE directory that was scanned. The discovered OpenAPI spec (.nightvision/openapi.yml) is resolved from here to attach source traceback, and the default output path is under here. Set this to the same project_path used for the scan; do NOT rely on the shell cwd, which is often the home directory and has no spec."),
  output: z.string().optional().describe("Output SARIF file path. Defaults to <project_path>/.nightvision/nightvision-<scan_id>.sarif"),
  output_file: z.string().optional().describe("Alias for output"),
  swagger_file: z.string().optional().describe("Explicit OpenAPI/Swagger file for source traceback. Overrides the spec auto-resolved from project_path."),
  randomize_issue_ids: z.boolean().optional().default(false).describe("Randomize issue IDs in the SARIF export"),
  format: z.enum(["json"]).optional().default("json").describe("Format of command output")
};

/**
 * Export CSV tool parameters schema
 */
export const ExportCsvParamsSchema = {
  scan_id: z.string().describe("ID of the scan to export to CSV"),
  project_path: z.string().optional().describe("App source directory that was scanned; the default output path is under here. Set this rather than relying on the shell cwd (often the home directory)."),
  output: z.string().optional().describe("Output CSV file path. Defaults to <project_path>/.nightvision/nightvision-<scan_id>.csv"),
  output_file: z.string().optional().describe("Alias for output"),
  format: z.enum(["json"]).optional().default("json").describe("Format of command output")
};

/**
 * Doctor/onboarding tool parameters schema
 */
export const DoctorParamsSchema = {
  validate_auth: z.boolean().optional().default(false).describe("Validate the saved NightVision token with the API. Defaults to false to avoid network calls during basic diagnostics."),
  format: z.enum(["json"]).optional().default("json").describe("Format of command output")
};

/**
 * Auth status tool parameters schema
 */
export const AuthStatusParamsSchema = {
  validate: z.boolean().optional().default(true).describe("Validate the saved NightVision token with the API when present"),
  format: z.enum(["json"]).optional().default("json").describe("Format of command output")
};

/**
 * Login help tool parameters schema
 */
export const LoginHelpParamsSchema = {
  format: z.enum(["json"]).optional().default("json").describe("Format of command output")
};

/**
 * Upload nuclei template tool parameters schema
 */
export const UploadNucleiTemplateParamsSchema = {
  template_id: z.string().describe("ID of the nuclei template to upload to"),
  file_path: z.string().describe("Path to the YAML file containing the nuclei template (absolute or relative path)"),
  project_path: z.string().optional().describe("Absolute path to the project directory (for resolving relative file paths)"),
  format: z.enum(["text", "json", "table"]).optional().default("json").describe("Format of command output")
};

/**
 * Create nuclei template tool parameters schema
 */
export const CreateNucleiTemplateParamsSchema = {
  name: z.string().describe("Name of the nuclei template (required)"),
  description: z.string().optional().describe("Description of the nuclei template (optional)"),
  project_id: z.string().uuid().describe("UUID of the project to associate the template with (required)"),
  format: z.enum(["text", "json", "table"]).optional().default("json").describe("Format of command output")
};

/**
 * Target object structure
 */
export interface Target {
  name: string;
  id: string;
  location: string;
  project_name: string;
  project: string;
  project_id?: string;
  type: string;
  is_ready_to_scan: boolean;
  [key: string]: any;
}

/**
 * Formatted target list response
 */
export interface FormattedTargetList {
  totalTargets: number;
  targets: {
    name: string;
    id: string;
    location: string;
    project: string;
    type: string;
    isReadyToScan: boolean;
  }[];
}

/**
 * API discovery tool parameters schema
 */
export const ApiDiscoveryParamsSchema = {
  source_paths: z.array(z.string()).describe("Absolute paths to code directories to analyze (must be absolute paths, not relative). The provided paths should be used exactly as specified by the user."),
  langs: z.union([
    z.enum(["csharp", "go", "java", "js", "php", "python", "ruby"]),
    z.array(z.enum(["csharp", "go", "java", "js", "php", "python", "ruby"]))
  ]).optional().describe("Language(s) of the target code. Can be a single language or an array of languages for multi-language projects. If not provided, the AI client should analyze the source code to identify the language(s)."),
  target: z.string().optional().describe("Target name to upload the swagger file to"),
  target_id: z.string().uuid().optional().describe("Target UUID to upload the swagger file to"),
  project: z.string().optional().describe("Project name for the swagger extract"),
  project_id: z.string().uuid().optional().describe("Project UUID for the swagger extract"),
  output: z.string().describe("Output file to store the OpenAPI specs (required)"),
  exclude: z.string().optional().describe("Files or directories to exclude from analysis (comma-separated, e.g. 'vendor/*,*.json')"),
  version: z.string().optional().default("0.1").describe("Version for the OpenAPI specs"),
  no_upload: z.boolean().optional().default(true).describe("Skip creation of a new target in the Nightvision API"),
  dump_code: z.boolean().optional().describe("Include code snippets in the generated spec")
};

/**
 * Preflight app tool parameters schema
 */
export const PreflightAppParamsSchema = {
  project_path: z.string().optional().describe("Absolute path to the app's SOURCE directory (the repo you are scanning). Set this explicitly; do not rely on the default working directory, which is often the shell's home directory and has no app source. API Discovery inspects this path."),
  target_url: z.string().optional().describe("The running app URL to scan, e.g. http://127.0.0.1:8080. The agent running this harness knows it; the harness does not guess. Required to start a scan"),
  app_name: z.string().optional().describe("Application or service name override"),
  project_name: z.string().optional().describe("NightVision project name override"),
  timeout_seconds: z.number().optional().default(5).describe("Reachability timeout per URL"),
  format: z.enum(["json"]).optional().default("json").describe("Format of command output")
};

/**
 * Guided app security scan tool parameters schema
 */
export const RunAppSecurityScanParamsSchema = {
  project_path: z.string().optional().describe("Absolute path to the app's SOURCE directory (the repo you just built or changed). Set this explicitly; do not rely on the default working directory, which is often the shell's home directory and has no app source. API Discovery and source-linking read from this path, so a wrong path means the scan exercises no endpoints and findings lose their source file:line."),
  target_url: z.string().optional().describe("The running app URL to scan, e.g. http://127.0.0.1:8080. The agent running this harness knows it; the harness does not guess. Required to start a scan"),
  app_name: z.string().optional().describe("Application or service name override"),
  nightvision_project: z.string().optional().describe("NightVision project name. Defaults to NIGHTVISION_DEFAULT_PROJECT"),
  nightvision_project_id: z.string().uuid().optional().describe("NightVision project UUID"),
  target_name: z.string().optional().describe("NightVision target name override"),
  auth: z.string().optional().describe("NightVision target auth profile name for authenticated scan"),
  auth_id: z.string().uuid().optional().describe("NightVision target auth profile UUID"),
  no_auth: z.boolean().optional().describe("Run scan without target app auth"),
  app_auth: z.object({
    type: z.enum(["headers", "cookies", "playwright_script"]).describe("Type of NightVision target app authentication credential to create before scanning. Username/password login flows must be represented as Playwright script auth."),
    name: z.string().optional().describe("Credential name. Defaults to <target_name>-auth"),
    description: z.string().optional().describe("Credential description"),
    credential_lifetime: z.enum(["stable", "session", "unknown"]).optional().default("unknown").describe("For headers/cookies, set stable only for non-expiring or managed app credentials. Use playwright_script for username/password login flows or expiring session cookies/tokens."),
    headers: z.array(z.object({
      name: z.string().describe("HTTP header name"),
      value: z.string().describe("HTTP header value")
    })).optional().describe("Headers for header-based target app auth"),
    cookies: z.array(z.object({
      name: z.string().describe("Cookie name"),
      value: z.string().describe("Cookie value")
    })).optional().describe("Cookies for cookie-based target app auth"),
    script_content: z.string().optional().describe("Playwright script content for script-based target app auth"),
    script_first_url: z.string().optional().describe("First URL for Playwright script target app auth")
  }).optional().describe("Create a NightVision target app auth credential before scanning when Claude/user knows the app credentials. Never use this for NightVision account auth."),
  force_private_scan: z.boolean().optional().default(false).describe("Force the CLI Smart Proxy/private scan path only when automatic private-scan detection needs an override"),
  wait: z.boolean().optional().default(false).describe("Wait for scan completion. Defaults to false because DAST scans commonly run longer than 10 minutes; prefer returning the scan ID and polling later."),
  timeout_seconds: z.number().optional().default(3600).describe("Maximum seconds to wait for scan completion when wait is true"),
  dry_run: z.boolean().optional().default(false).describe("Describe the workflow without creating targets or starting scans"),
  format: z.enum(["json"]).optional().default("json").describe("Format of command output")
};

/**
 * List nuclei templates tool parameters schema
 */
export const ListNucleiTemplatesParamsSchema = {
  project_id: z.string().uuid().optional().describe("UUID of the project to filter templates by"),
  filter: z.string().optional().describe("Filter string to narrow down templates by name"),
  page: z.number().optional().describe("Page number for pagination"),
  page_size: z.number().optional().default(100).describe("Number of items per page (defaults to 100)"),
  severity: z.array(z.enum(["critical", "high", "medium", "low", "info", "unknown", "unspecified"])).optional()
    .describe("Array of severity levels to filter by"),
  target: z.string().uuid().optional().describe("UUID of the target to filter templates by"),
  format: z.enum(["text", "json", "table"]).optional().default("json").describe("Format of command output")
};

/**
 * Get scan paths tool parameters schema
 */
export const GetScanPathsParamsSchema = {
  scan_id: z.string().describe("ID of the scan to get checked paths for"),
  page: z.number().optional().describe("Page number for pagination"),
  page_size: z.number().optional().describe("Number of items per page"),
  filter: z.string().optional().describe("Filter string to narrow down the paths"),
  format: z.enum(["text", "json", "table"]).optional().default("json").describe("Format of command output")
};

/**
 * Assign nuclei template to target tool parameters schema
 */
export const AssignNucleiTemplateParamsSchema = {
  target_id: z.string().describe("ID of the target to assign the template to"),
  template_id: z.string().describe("ID of the nuclei template to assign"),
  format: z.enum(["text", "json", "table"]).optional().default("json").describe("Format of command output")
};

/**
 * Record traffic tool parameters schema
 */
export const RecordTrafficParamsSchema = {
  name: z.string().describe("Name for the traffic recording"),
  url: z.string().describe("URL to record traffic from"),
  target: z.string().describe("Name of the target"),
  project: z.string().describe("Name of the project"),
  format: z.enum(["text", "json", "table"]).optional().default("text").describe("Format of command output")
};

/**
 * List traffic files tool parameters schema
 */
export const ListTrafficParamsSchema = {
  target: z.string().describe("Name of the target"),
  project: z.string().describe("Name of the project"),
  format: z.enum(["text", "json", "table"]).optional().default("json").describe("Format of command output")
};

/**
 * Download traffic file tool parameters schema
 */
export const DownloadTrafficParamsSchema = {
  name: z.string().describe("Name of the traffic file to download"),
  target: z.string().describe("Name of the target"),
  project: z.string().describe("Name of the project"),
  output_file: z.string().optional().describe("Path where to save the downloaded HAR file (optional)"),
  downloadPath: z.string().optional().describe("Absolute directory path to download into. If it is not an absolute, writable directory, the home directory is used, then the system temp directory."),
  format: z.enum(["text", "json", "table"]).optional().default("text").describe("Format of command output")
};

/**
 * List issues (findings) tool parameters schema
 */
export const ListIssuesParamsSchema = {
  scan_id: z.string().describe("ID of the scan to get findings for"),
  page: z.number().optional().describe("Page number for pagination"),
  page_size: z.number().optional().default(50).describe("Number of items per page (defaults to 50)"),
  severity: z.array(z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFORMATIONAL", "UNSPECIFIED"])).optional()
    .describe("Filter by severity levels"),
  resolution: z.array(z.number()).optional()
    .describe("Filter by resolution: 0=open, 1=false_positive, 2=resolved, 3=excluded_false_positive"),
  kind: z.array(z.number()).optional().describe("Filter by issue kind IDs"),
  filter: z.string().optional().describe("Text filter for url_path, parameter_name, or target name"),
  format: z.enum(["text", "json", "table"]).optional().default("json").describe("Format of command output")
};

/**
 * Get issue details tool parameters schema
 */
export const GetIssueDetailsParamsSchema = {
  issue_id: z.string().describe("UUID of the issue to get full details for"),
  format: z.enum(["text", "json", "table"]).optional().default("json").describe("Format of command output")
};

/**
 * Get issue kind statistics tool parameters schema
 */
export const GetIssueKindStatsParamsSchema = {
  scan_id: z.string().describe("ID of the scan to get issue kind statistics for"),
  filter: z.string().optional().describe("Text filter for kind names"),
  format: z.enum(["text", "json", "table"]).optional().default("json").describe("Format of command output")
};

/**
 * Get vulnerable paths tool parameters schema
 */
export const GetVulnerablePathsParamsSchema = {
  scan_id: z.string().describe("ID of the scan to get vulnerable paths for"),
  kind: z.array(z.number()).optional().describe("Filter by issue kind IDs"),
  nuclei_template: z.array(z.string()).optional().describe("Filter by nuclei template UUIDs"),
  resolution: z.array(z.number()).optional()
    .describe("Filter by resolution: 0=open, 1=false_positive, 2=resolved"),
  filter: z.string().optional().describe("Text filter for paths")
};

/**
 * Get issue occurrences tool parameters schema
 */
export const GetIssueOccurrencesParamsSchema = {
  scan_id: z.string().describe("ID of the scan"),
  url_path: z.string().describe("URL path to get occurrences for"),
  http_method: z.string().describe("HTTP method (GET, POST, etc.)"),
  kind_id: z.number().optional().describe("Issue kind ID (required if no nuclei_template_id)"),
  nuclei_template_id: z.string().optional().describe("Nuclei template UUID (required if no kind_id)"),
  parameter_name: z.string().optional().describe("Filter by parameter name"),
  resolution: z.array(z.number()).optional()
    .describe("Filter by resolution: 0=open, 1=false_positive, 2=resolved")
};

/**
 * Create username/password credential tool parameters schema
 */
export const CreateUserPassCredentialParamsSchema = {
  name: z.string().describe("Name for the credential. Deprecated for target app login flows. Use Playwright script auth instead."),
  username: z.string().describe("Username. Deprecated for target app login flows. Use Playwright script auth instead."),
  password: z.string().describe("Password. Deprecated for target app login flows. Use Playwright script auth instead."),
  project: z.string().describe("Project UUID"),
  description: z.string().optional().describe("Description")
};

/**
 * Create header-based credential tool parameters schema
 */
export const CreateHeaderCredentialParamsSchema = {
  name: z.string().describe("Name for the credential"),
  headers: z.array(z.object({
    name: z.string().describe("Header name (e.g. 'Authorization')"),
    value: z.string().describe("Header value (e.g. 'Bearer xyz')")
  })).describe("List of headers to include in authenticated requests"),
  project: z.string().describe("Project UUID"),
  credential_lifetime: z.enum(["stable", "session", "unknown"]).optional().default("unknown").describe("Must be stable for header auth. Use Playwright script auth for username/password login flows or expiring session tokens."),
  description: z.string().optional().describe("Description")
};

/**
 * Create cookie-based credential tool parameters schema
 */
export const CreateCookieCredentialParamsSchema = {
  name: z.string().describe("Name for the credential"),
  cookies: z.array(z.object({
    name: z.string().describe("Cookie name"),
    value: z.string().describe("Cookie value")
  })).describe("List of cookies to include in authenticated requests"),
  project: z.string().describe("Project UUID"),
  credential_lifetime: z.enum(["stable", "session", "unknown"]).optional().default("unknown").describe("Must be stable for cookie auth. Use Playwright script auth for username/password login flows or expiring session cookies."),
  description: z.string().optional().describe("Description")
};

/**
 * Assign credential to targets tool parameters schema
 */
export const AssignCredentialToTargetsParamsSchema = {
  credential_id: z.string().describe("UUID of the credential"),
  target_ids: z.array(z.string()).describe("List of target UUIDs to assign the credential to")
};

/**
 * Save Playwright script credential tool parameters schema
 */
export const SavePlaywrightScriptParamsSchema = {
  name: z.string().describe("Name for the credential (e.g. 'login-flow')"),
  script_content: z.string().describe("The Playwright script content"),
  project: z.string().describe("Project UUID to save the credential in"),
  script_first_url: z.string().optional().describe("The first URL the script navigates to"),
  description: z.string().optional().describe("Description of the credential")
};

/**
 * Update Playwright script credential tool parameters schema
 */
export const UpdatePlaywrightScriptParamsSchema = {
  id: z.string().describe("UUID of the credential to update"),
  name: z.string().optional().describe("New name for the credential"),
  script_content: z.string().optional().describe("Updated Playwright script content"),
  script_first_url: z.string().optional().describe("Updated first URL"),
  description: z.string().optional().describe("Updated description")
};

/**
 * Get auth credential tool parameters schema
 */
export const GetAuthCredentialParamsSchema = {
  id: z.string().optional().describe("UUID of the credential"),
  name: z.string().optional().describe("Name of the credential (requires project_id)"),
  project_id: z.string().optional().describe("Project UUID (required when using name)")
};

/**
 * List auth credentials tool parameters schema
 */
export const ListAuthCredentialsParamsSchema = {
  project_id: z.string().optional().describe("Project UUID to filter by")
};

/**
 * Find target tool parameters schema
 */
export const FindTargetParamsSchema = {
  name: z.string().describe("Target name or partial name to search for")
};

/**
 * List additional paths tool parameters schema
 */
export const ListAdditionalPathsParamsSchema = {
  target_id: z.string().describe("UUID of the target")
};

/**
 * Add additional paths tool parameters schema
 */
export const AddAdditionalPathsParamsSchema = {
  target_id: z.string().describe("UUID of the target"),
  paths: z.array(z.string()).describe("List of URL paths to add (e.g. ['/api/users', '/admin/login'])")
};
