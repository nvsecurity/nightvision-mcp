import type {
  McpServer,
  ToolCallback,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ZodRawShapeCompat } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

type RequiredToolHints = Required<
  Pick<ToolAnnotations, 'readOnlyHint' | 'destructiveHint' | 'openWorldHint'>
> &
  Pick<ToolAnnotations, 'idempotentHint'>;

interface NightVisionToolMetadata {
  title: string;
  description: string;
  annotations: RequiredToolHints;
}

const READ_ONLY: RequiredToolHints = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
  idempotentHint: true,
};

const READ_ONLY_EXTERNAL: RequiredToolHints = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: true,
  idempotentHint: true,
};

const INTERNAL_WRITE: RequiredToolHints = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false,
};

const DESTRUCTIVE_INTERNAL_WRITE: RequiredToolHints = {
  readOnlyHint: false,
  destructiveHint: true,
  openWorldHint: false,
};

const DESTRUCTIVE_EXTERNAL_WRITE: RequiredToolHints = {
  readOnlyHint: false,
  destructiveHint: true,
  openWorldHint: true,
};

const EXTERNAL_WRITE: RequiredToolHints = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: true,
};

export const NIGHTVISION_TOOL_METADATA = {
  'authenticate': {
    title: 'Authenticate with NightVision',
    description: 'Checks NightVision authentication or saves and verifies a user-supplied or newly created NightVision API token.',
    annotations: INTERNAL_WRITE,
  },
  'create-header-credential': {
    title: 'Create header credential',
    description: 'Creates a stable header-based application credential in the user’s NightVision project.',
    annotations: INTERNAL_WRITE,
  },
  'create-cookie-credential': {
    title: 'Create cookie credential',
    description: 'Creates a stable cookie-based application credential in the user’s NightVision project.',
    annotations: INTERNAL_WRITE,
  },
  'assign-credential-to-targets': {
    title: 'Assign credential to targets',
    description: 'Assigns an existing NightVision application credential to one or more targets.',
    annotations: INTERNAL_WRITE,
  },
  'save-playwright-script': {
    title: 'Save Playwright authentication script',
    description: 'Creates a Playwright script credential for authenticated NightVision scans.',
    annotations: INTERNAL_WRITE,
  },
  'update-playwright-script': {
    title: 'Update Playwright authentication script',
    description: 'Updates the stored script or metadata for a NightVision Playwright credential.',
    annotations: DESTRUCTIVE_INTERNAL_WRITE,
  },
  'get-auth-credential': {
    title: 'Get authentication credential',
    description: 'Retrieves one NightVision application credential, redacting stored header and cookie values.',
    annotations: READ_ONLY,
  },
  'list-auth-credentials': {
    title: 'List authentication credentials',
    description: 'Lists NightVision application credentials visible to the authenticated user.',
    annotations: READ_ONLY,
  },
  'login-help': {
    title: 'Get NightVision login help',
    description: 'Returns local NightVision login instructions without changing authentication state.',
    annotations: READ_ONLY,
  },
  'doctor': {
    title: 'Check NightVision setup',
    description: 'Checks local CLI, token, API connectivity, project, repository, and target URL readiness.',
    annotations: READ_ONLY_EXTERNAL,
  },
  'auth-status': {
    title: 'Check authentication status',
    description: 'Checks whether the current NightVision token is present and valid.',
    annotations: READ_ONLY,
  },
  'discover-api': {
    title: 'Discover APIs from source',
    description: 'Analyzes application source code and writes an OpenAPI specification, optionally uploading it to a NightVision target.',
    annotations: DESTRUCTIVE_INTERNAL_WRITE,
  },
  'export-sarif': {
    title: 'Export scan results as SARIF',
    description: 'Exports a completed NightVision scan to a local SARIF file and reports source-linked findings when available.',
    annotations: DESTRUCTIVE_INTERNAL_WRITE,
  },
  'export-csv': {
    title: 'Export scan results as CSV',
    description: 'Exports a completed NightVision scan to a local CSV file.',
    annotations: DESTRUCTIVE_INTERNAL_WRITE,
  },
  'list-issues': {
    title: 'List security issues',
    description: 'Lists NightVision security issues using the requested project, target, scan, severity, status, or kind filters.',
    annotations: READ_ONLY,
  },
  'get-issue-details': {
    title: 'Get security issue details',
    description: 'Retrieves details and evidence for one NightVision security issue.',
    annotations: READ_ONLY,
  },
  'get-issue-kind-stats': {
    title: 'Get issue kind statistics',
    description: 'Returns aggregate NightVision issue counts grouped by vulnerability kind.',
    annotations: READ_ONLY,
  },
  'get-vulnerable-paths': {
    title: 'Get vulnerable paths',
    description: 'Lists application paths associated with NightVision security issues.',
    annotations: READ_ONLY,
  },
  'get-issue-occurrences': {
    title: 'Get issue occurrences',
    description: 'Retrieves individual occurrences of a NightVision security issue.',
    annotations: READ_ONLY,
  },
  'run-app-security-scan': {
    title: 'Run application security scan',
    description: 'Coordinates source discovery, target setup, authentication, and an active NightVision DAST scan, then writes local scan artifacts.',
    annotations: DESTRUCTIVE_EXTERNAL_WRITE,
  },
  'create-nuclei-template': {
    title: 'Create security test template',
    description: 'Creates and uploads a custom NightVision security test template from supplied YAML.',
    annotations: INTERNAL_WRITE,
  },
  'upload-nuclei-template': {
    title: 'Upload security test template',
    description: 'Uploads a local security test template to the authenticated NightVision account.',
    annotations: DESTRUCTIVE_INTERNAL_WRITE,
  },
  'list-nuclei-templates': {
    title: 'List security test templates',
    description: 'Lists custom and available NightVision security test templates.',
    annotations: READ_ONLY,
  },
  'assign-nuclei-template': {
    title: 'Assign security test template',
    description: 'Assigns an uploaded security test template to a NightVision target.',
    annotations: INTERNAL_WRITE,
  },
  'preflight-app': {
    title: 'Check application scan readiness',
    description: 'Inspects an application repository, checks its target URL, and writes a local NightVision readiness manifest without starting a scan.',
    annotations: DESTRUCTIVE_EXTERNAL_WRITE,
  },
  'list-projects': {
    title: 'List NightVision projects',
    description: 'Lists NightVision projects visible to the authenticated user.',
    annotations: READ_ONLY,
  },
  'get-project-details': {
    title: 'Get NightVision project details',
    description: 'Retrieves details for one NightVision project by name or identifier.',
    annotations: READ_ONLY,
  },
  'start-scan': {
    title: 'Start NightVision scan',
    description: 'Starts an active NightVision DAST scan against an existing target and returns its scan identifier.',
    annotations: DESTRUCTIVE_EXTERNAL_WRITE,
  },
  'wait-for-scan': {
    title: 'Wait for scan completion',
    description: 'Polls a NightVision scan until it succeeds, fails, or reaches the requested timeout.',
    annotations: READ_ONLY,
  },
  'list-managed-scan-processes': {
    title: 'List managed scan processes',
    description: 'Lists local NightVision CLI relay processes managed by this MCP server.',
    annotations: READ_ONLY,
  },
  'get-managed-scan-process': {
    title: 'Get managed scan process',
    description: 'Retrieves status and buffered output for one local NightVision CLI relay process.',
    annotations: READ_ONLY,
  },
  'cancel-managed-scan-process': {
    title: 'Cancel managed scan process',
    description: 'Terminates one local NightVision CLI relay process managed by this MCP server.',
    annotations: DESTRUCTIVE_INTERNAL_WRITE,
  },
  'list-scans': {
    title: 'List NightVision scans',
    description: 'Lists NightVision scans using optional project, target, status, and time filters.',
    annotations: READ_ONLY,
  },
  'get-scan-status': {
    title: 'Get scan status',
    description: 'Retrieves the current status and summary data for one NightVision scan.',
    annotations: READ_ONLY,
  },
  'get-scan-checks': {
    title: 'Get scan checks',
    description: 'Retrieves vulnerability checks returned by one NightVision scan.',
    annotations: READ_ONLY,
  },
  'summarize-scan-findings': {
    title: 'Summarize scan findings',
    description: 'Summarizes and prioritizes findings returned by one NightVision scan.',
    annotations: READ_ONLY,
  },
  'get-scan-paths': {
    title: 'Get scanned paths',
    description: 'Lists application paths and response codes exercised during one NightVision scan.',
    annotations: READ_ONLY,
  },
  'list-check-categories': {
    title: 'List scan check categories',
    description: 'Lists the available NightVision scan check categories and identifiers.',
    annotations: READ_ONLY,
  },
  'list-targets': {
    title: 'List NightVision targets',
    description: 'Lists NightVision scan targets visible to the authenticated user.',
    annotations: READ_ONLY,
  },
  'get-target-details': {
    title: 'Get target details',
    description: 'Retrieves configuration and readiness details for one NightVision target.',
    annotations: READ_ONLY,
  },
  'create-target': {
    title: 'Create NightVision target',
    description: 'Creates a web or API scan target in an authorized NightVision project.',
    annotations: INTERNAL_WRITE,
  },
  'delete-target': {
    title: 'Delete NightVision target',
    description: 'Permanently deletes one NightVision target after resolving its project scope.',
    annotations: DESTRUCTIVE_INTERNAL_WRITE,
  },
  'find-target': {
    title: 'Find NightVision target',
    description: 'Finds NightVision targets by name across visible projects.',
    annotations: READ_ONLY,
  },
  'list-additional-paths': {
    title: 'List additional target paths',
    description: 'Lists user-configured paths that NightVision includes when scanning a target.',
    annotations: READ_ONLY,
  },
  'add-additional-paths': {
    title: 'Add target paths',
    description: 'Adds user-supplied paths to an existing NightVision scan target.',
    annotations: INTERNAL_WRITE,
  },
  'record-traffic': {
    title: 'Record application traffic',
    description: 'Opens the target application in a browser and records traffic for a NightVision scan workflow.',
    annotations: EXTERNAL_WRITE,
  },
  'list-traffic': {
    title: 'List recorded traffic',
    description: 'Lists traffic recordings associated with a NightVision target.',
    annotations: READ_ONLY,
  },
  'download-traffic': {
    title: 'Download recorded traffic',
    description: 'Downloads a NightVision traffic recording to a local file.',
    annotations: DESTRUCTIVE_INTERNAL_WRITE,
  },
} as const satisfies Record<string, NightVisionToolMetadata>;

export type NightVisionToolName = keyof typeof NIGHTVISION_TOOL_METADATA;

export function registerNightVisionTool<Args extends ZodRawShapeCompat>(
  server: McpServer,
  name: NightVisionToolName,
  paramsSchema: Args,
  callback: ToolCallback<Args>,
) {
  const metadata = NIGHTVISION_TOOL_METADATA[name];
  return server.registerTool(name, {
      title: metadata.title,
      description: metadata.description,
      inputSchema: paramsSchema,
      annotations: metadata.annotations,
    }, callback);
}
