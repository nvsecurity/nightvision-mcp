import { z } from 'zod';

/**
 * Common MCP tool response structure
 */
export interface McpResponse {
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
  projects: z.array(z.string()).optional().describe("Project names to filter the target list"),
  format: z.enum(["text", "json", "table"]).optional().default("json").describe("Format of command output")
};

/**
 * Get target details tool parameters schema
 */
export const GetTargetDetailsParamsSchema = {
  name: z.string().describe("Name of the target to get details for"),
  format: z.enum(["text", "json", "table"]).optional().default("json").describe("Format of command output")
};

/**
 * Create target tool parameters schema
 */
export const CreateTargetParamsSchema = {
  name: z.string().describe("Name of the target to create"),
  url: z.string().describe("URL of the target"),
  project: z.string().describe("Project Name of the target (required)"),
  project_id: z.string().optional().describe("Project UUID of the target"),
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
  format: z.enum(["text", "json", "table"]).optional().default("json").describe("Format of command output")
};

/**
 * Start scan tool parameters schema
 */
export const StartScanParamsSchema = {
  target_name: z.string().describe("Name of the target to scan"),
  auth: z.string().optional().describe("Authentication name to execute an authenticated scan"),
  auth_id: z.string().optional().describe("Authentication UUID for scan authentication"),
  no_auth: z.boolean().optional().describe("Set this flag to indicate not to include auth to the scan"),
  project: z.string().optional().describe("Project Name of the target to scan"),
  project_id: z.string().optional().describe("Project UUID of the target to scan"),
  format: z.enum(["text", "json", "table"]).optional().default("json").describe("Format of command output")
};

/**
 * List scans tool parameters schema
 */
export const ListScansParamsSchema = {
  target: z.string().optional().describe("Filter scans by target name"),
  project: z.string().optional().describe("Filter scans by project name"),
  project_id: z.string().optional().describe("Filter scans by project UUID"),
  limit: z.number().optional().describe("Maximum number of scans to return"),
  status: z.enum(["running", "finished", "failed", "all"]).optional().default("all").describe("Filter scans by status"),
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
 * Get scan checks (vulnerabilities) tool parameters schema
 */
export const GetScanChecksParamsSchema = {
  scan_id: z.string().describe("ID of the scan to get vulnerability checks for"),
  page: z.number().optional().describe("Page number for pagination"),
  page_size: z.number().optional().describe("Number of items per page"),
  name: z.string().optional().describe("Filter vulnerability checks by name"),
  check_kind: z.string().optional().describe("Filter vulnerability checks by specific kind"),
  severity: z.array(z.enum(["critical", "high", "medium", "low", "info", "unknown", "unspecified"])).describe("Filter vulnerabilities by severity levels (can specify multiple)"),
  status: z.array(z.number().refine(val => [0, 1, 2, 3].includes(val), {
    message: "Status must be one of: 0, 1, 2, 3"
  })).describe("Filter vulnerabilities by status codes: 0, 1, 2, 3"),
  format: z.enum(["text", "json", "table"]).optional().default("json").describe("Format of command output")
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
  project_id: z.string().describe("UUID of the project to associate the template with (required)"),
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
  source_paths: z.array(z.string()).describe("Paths to code directories to analyze (can specify multiple)"),
  lang: z.enum(["csharp", "go", "java", "js", "python", "ruby"]).describe("Language of the target code"),
  target: z.string().optional().describe("Target name to upload the swagger file to"),
  target_id: z.string().optional().describe("Target UUID to upload the swagger file to"),
  project: z.string().optional().describe("Project name for the swagger extract"),
  project_id: z.string().optional().describe("Project UUID for the swagger extract"),
  output: z.string().describe("Output file to store the OpenAPI specs (required)"),
  exclude: z.string().optional().describe("Files or directories to exclude from analysis (comma-separated, e.g. 'vendor/*,*.json')"),
  version: z.string().optional().default("0.1").describe("Version for the OpenAPI specs"),
  no_upload: z.boolean().optional().default(true).describe("Skip creation of a new target in the Nightvision API"),
  dump_code: z.boolean().optional().describe("Include code snippets in the generated spec"),
  verbose: z.boolean().optional().default(false).describe("Enable verbose output for detailed information about the API discovery process"),
  format: z.enum(["text", "json", "table"]).optional().default("text").describe("Format of command output")
};

/**
 * List nuclei templates tool parameters schema
 */
export const ListNucleiTemplatesParamsSchema = {
  project_id: z.string().optional().describe("UUID of the project to filter templates by"),
  filter: z.string().optional().describe("Filter string to narrow down templates by name"),
  page: z.number().optional().describe("Page number for pagination"),
  page_size: z.number().optional().default(100).describe("Number of items per page (defaults to 100)"),
  severity: z.array(z.enum(["critical", "high", "medium", "low", "info", "unknown", "unspecified"])).optional()
    .describe("Array of severity levels to filter by"),
  target: z.string().optional().describe("UUID of the target to filter templates by"),
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
  downloadPath: z.string().optional().describe("Absolute directory path where to download the file (must be writable)"),
  format: z.enum(["text", "json", "table"]).optional().default("text").describe("Format of command output")
}; 