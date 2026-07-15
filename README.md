# NightVision MCP Server

A Model Context Protocol (MCP) server that enables AI assistants to interact with the NightVision security platform, providing comprehensive capabilities for security testing, scanning, template management, and vulnerability analysis.

## Features

- List NightVision targets with filtering options
- Get detailed information about specific targets
- Create new targets with customizable options
- Delete targets when they are no longer needed
- Find targets and manage their additional scan paths
- Start security scans against targets, optionally limited to specific checks
- Run a guided app security scan harness for local, private, staging, and internal apps
- Keep local/private scan CLI processes managed while returning scan IDs to the agent
- Track scan status and view results
- Export scan findings to SARIF or CSV, with safeguards against empty or misleading exports
- View and filter vulnerabilities found in security scans
- Inspect individual findings with full HTTP request/response detail (secrets redacted)
- Diagnose setup and authentication readiness with `doctor` and `auth-status`
- Manage target app authentication credentials with Playwright script, stable header, and stable cookie auth
- Discover API endpoints from source code (multiple languages)
- Manage projects and view project details
- Record, list, and download browser traffic for targets
- Upload and assign custom nuclei templates for targeted vulnerability scanning
- Integration with Claude and other MCP-compatible assistants

## Prerequisites

- Node.js 22 or later
- NightVision CLI 0.5.0 or later, installed and on your `PATH`
- Valid NightVision account and authentication

The server runs the `nightvision` CLI it finds on your `PATH` and depends on its
command and flag surface (for example `swagger extract --file-format`). It checks
for the CLI at startup and logs a warning if the version is older than the
supported minimum (0.5.0, where the API-discovery flags this server uses became
available); a newer CLI is recommended. Upgrade the CLI the way you installed it.

## Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/nvsecurity/nightvision-mcp.git
   cd nightvision-mcp
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the TypeScript code:
   ```bash
   npm run build
   ```

### Using with Claude for Desktop

1. Edit your Claude for Desktop configuration file:
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`

2. Add this MCP server configuration:
   ```json
   {
     "mcpServers": {
       "nightvision": {
         "command": "node",
         "args": ["/absolute/path/to/build/index.js"],
         "env": {
           "NIGHTVISION_CLI_PATH": "/absolute/path/to/nightvision"
         }
       }
     }
   }
   ```

   `NIGHTVISION_CLI_PATH` is optional when the MCP client can already find `nightvision` on `PATH`. It is recommended for desktop clients launched outside a login shell, such as Claude for Desktop on macOS.

3. Restart Claude for Desktop.

### Using with Cursor

1. Configure the MCP server integration by adding it to one of the following locations:

   - **Project Configuration** (recommended for project-specific use):  
     Create a `.cursor/mcp.json` file in your project directory with the following content:
     ```json
     {
       "mcpServers": {
         "nightvision": {
           "command": "node",
           "args": ["/absolute/path/to/build/index.js"]
         }
       }
     }
     ```

   - **Global Configuration** (for use across all projects):  
     Create a `~/.cursor/mcp.json` file in your home directory with the same content as above.

2. Restart Cursor or reload the window

3. The NightVision tools will now be available to Cursor's AI assistant.

## Upgrading an Existing Installation

If you already have the server installed:

1. Pull the latest code with `git pull`.
2. Reinstall dependencies and rebuild; a restart alone is not enough when dependencies or compiled output change:
   ```bash
   npm install
   npm run rebuild
   ```
3. Restart your MCP client (Claude for Desktop or Cursor) so it reloads the server.

Your saved token in `~/.nightvision/token` keeps working, so no re-authentication or MCP client config change is needed. The supported Node.js version is declared under `engines` in `package.json`, and `npm install` warns if yours is older. Review recent commits for any tool parameter changes that affect saved prompts.

## Usage

### Authentication

The NightVision MCP Server requires authentication to interact with the NightVision API. You have three options for authentication:

1. **Use an existing token** - If you already have a NightVision API token, you can provide it to the server.
2. **Create a new token** - The server can create a new token for you using the NightVision CLI.
3. **Use the token saved from a previous session** - Tokens are stored locally for convenience.

#### Using the Authentication Tool

The server provides an `authenticate` tool that can be used from any MCP client (Claude Desktop, Cursor, etc.):

```
Can you create a new NightVision authentication token?
```

To check current authentication status:

```
Can you check if I'm authenticated with NightVision?
```

#### Token Storage

Authentication tokens are stored in `~/.nightvision/token` on your machine. This allows the server to remain authenticated between restarts.

#### Environment Variables

The server reads the following optional environment variables (set them in your MCP client's server config, e.g. the `env` block shown above):

| Variable | Purpose |
|:---------|:--------|
| `NIGHTVISION_CLI_PATH` | Absolute path to the `nightvision` CLI. Optional when the CLI is already on `PATH`; recommended for desktop clients launched outside a login shell. |
| `NIGHTVISION_DEFAULT_PROJECT` | Default NightVision project name for the guided harness when no `nightvision_project` is passed. |
| `NIGHTVISION_CREDS_ID` | Default target-app auth credential UUID applied by `run-app-security-scan` when the caller passes no `auth`/`auth_id`. Leave unset to scan unauthenticated by default. |
| `NIGHTVISION_API_URL` | Overrides the API base URL (default `https://api.nightvision.net/api/v1/`). Intended for self-hosted API endpoints and the test harness; it redirects all API traffic, including where your token is sent, so only point it at a NightVision endpoint you trust. |

### Guided App Security Scan

For local, private, staging, or internal apps, prefer the guided harness instead of asking the assistant to manually choose every primitive.

Core tools:

- `doctor`: checks CLI availability, CLI version, token presence, and optional token validity.
- `auth-status`: reports whether the current MCP process has usable NightVision auth.
- `preflight-app`: inspects a repo/app, detects language/framework hints, checks runtime reachability, suggests project/target names, and writes `.nightvision/manifest.json`.
- `run-app-security-scan`: runs the DAST-first workflow: preflight, API Discovery when source is available, target create/update/reuse, scan start, scan ID return, and manifest writing.
- `list-managed-scan-processes`, `get-managed-scan-process`, `cancel-managed-scan-process`: inspect or clean up managed local scan CLI processes.

Example request:

```
Run a NightVision app security scan for this local API at http://127.0.0.1:8080.
```

Example dry run request:

```
Check whether this app is ready for a NightVision scan, but do not create targets or start DAST yet.
```

DAST is the expected outcome for the guided workflow. If DAST cannot run, the harness returns structured blockers and writes them to `.nightvision/manifest.json`. When you do not pass an explicit `target_name`, the harness derives a stable one of the form `<app>-local-<your OS username>` so repeated runs reuse the same NightVision target; pass `target_name` to override it.

DAST scans commonly run longer than 10 minutes. The guided harness defaults to returning after scan start with the scan ID and manifest path. For local/private apps, keep the MCP server process running so the NightVision CLI relay stays alive. Poll with `get-scan-status`, `list-scans`, or `wait-for-scan`, then export results with `export-sarif` after the scan reaches a terminal status. A terminal `FAILED` status can still contain valid findings, so check `issues_count` and export available results before treating the run as unusable. Use `wait: true` only when the MCP client can keep a single tool call open for the full scan duration.

Target app auth rules:

- Use Playwright script auth for username/password login flows, browser login, OAuth, MFA, or expiring sessions.
- Do not turn an expiring session cookie or bearer token into a header/cookie credential.
- Header and cookie credentials are allowed only for stable non-expiring app credentials, such as durable service API keys.
- Direct username/password credential creation is blocked by this MCP path. Use `save-playwright-script` or `run-app-security-scan` with `app_auth.type="playwright_script"`.

### Available Tools

The server provides the following tools:

#### `authenticate`

Manages authentication with the NightVision API.

Parameters:
- `token` (string, optional): NightVision API token to use for authentication
- `create_new` (boolean, optional): Create a new token instead of using an existing one
- `expiry_date` (string, optional): Expiry date for new token in format YYYY-MM-DD

Example commands in Claude or Cursor:
```
Can you create a new NightVision authentication token?
```
```
Can you authenticate with NightVision using token "my-token-value"?
```

#### `doctor`

Checks overall setup readiness: CLI availability and version, token presence, optional token validation, and relevant environment variables. Returns structured blockers and next steps when setup is not ready.

Parameters:
- `validate_auth` (boolean, optional, default: false): Validate the saved NightVision token with the API
- `format` (enum: "json", optional, default: "json"): Format of command output

Example command:
```
Run the NightVision doctor check and tell me if anything is missing.
```

#### `auth-status`

Reports whether the current MCP process has usable NightVision authentication, with optional live token validation.

Parameters:
- `validate` (boolean, optional, default: true): Validate the saved token with the API when present
- `format` (enum: "json", optional, default: "json"): Format of command output

#### `login-help`

Returns the API URL, the exact CLI login command, and the token file location, along with token-safety guidance. Takes no parameters other than `format`.

### Guided Scan Tools

See the [Guided App Security Scan](#guided-app-security-scan) section above for the recommended workflow.

#### `preflight-app`

Inspects a repo/app without creating targets or starting scans: detects language/framework hints, checks runtime reachability, suggests project/target names, and writes `.nightvision/manifest.json`.

Parameters:
- `project_path` (string, optional): Path to the app/repo. Defaults to the MCP server working directory
- `target_url` (string): The running app URL to scan, e.g. `http://127.0.0.1:8080`. The agent driving this harness knows it; the harness does not guess. Required to start a scan
- `app_name` (string, optional): Application or service name override
- `project_name` (string, optional): NightVision project name override
- `timeout_seconds` (number, optional, default: 5): Reachability timeout per URL
- `format` (enum: "json", optional, default: "json"): Format of command output

#### `run-app-security-scan`

Runs the DAST-first guided workflow: preflight, API Discovery when source is available, target create/update/reuse, scan start, scan ID return, and manifest writing.

Parameters:
- `project_path` (string, optional): Path to the app/repo. Defaults to the MCP server working directory
- `target_url` (string): The running app URL to scan, e.g. `http://127.0.0.1:8080`. The agent driving this harness knows it; the harness does not guess. Required to start a scan
- `app_name` (string, optional): Application or service name override
- `nightvision_project` (string, optional): NightVision project name. Defaults to `NIGHTVISION_DEFAULT_PROJECT`
- `nightvision_project_id` (string, optional): NightVision project UUID
- `target_name` (string, optional): NightVision target name override
- `auth` (string, optional): Existing NightVision target auth profile name for an authenticated scan
- `auth_id` (string, optional): Existing NightVision target auth profile UUID
- `no_auth` (boolean, optional): Run the scan without target app auth
- `app_auth` (object, optional): Create a target app auth credential before scanning. `type` is one of `headers`, `cookies`, `playwright_script`; username/password login flows must use `playwright_script`. Header/cookie credentials require `credential_lifetime: "stable"`.
- `force_private_scan` (boolean, optional, default: false): Force the CLI Smart Proxy/private scan path when automatic detection needs an override
- `wait` (boolean, optional, default: false): Wait for scan completion. Defaults to false because DAST scans commonly run longer than 10 minutes; prefer returning the scan ID and polling later
- `timeout_seconds` (number, optional, default: 3600): Maximum seconds to wait for scan completion when `wait` is true
- `dry_run` (boolean, optional, default: false): Describe the workflow without creating targets or starting scans
- `format` (enum: "json", optional, default: "json"): Format of command output

#### `list-managed-scan-processes`, `get-managed-scan-process`, `cancel-managed-scan-process`

Inspect or clean up the NightVision CLI processes the server keeps alive for local/private Smart Proxy relay. `get-managed-scan-process` and `cancel-managed-scan-process` take a `scan_id`; `list-managed-scan-processes` takes no parameters.

#### `list-targets`

Lists all NightVision targets with optional filtering.

Parameters:
- `all` (boolean, optional): Specify to get targets against all projects
- `projects` (string[], optional): Project names to filter the target list
- `format` (enum: "text" | "json" | "table", optional, default: "json"): Format of command output

Example command in Claude:
```
Can you list all my NightVision targets? If there are too many, just show those in my current project.
```

#### `get-target-details`

Gets detailed information about a specific target.

Parameters:
- `name` (string): Name of the target to get details for
- `project` (string, optional): Project name of the target (disambiguates a name shared across projects)
- `project_id` (string, optional): Project UUID of the target (disambiguates a name shared across projects)

Example command in Claude:
```
Can you show me details about my NightVision target called "testphp"?
```

#### `create-target`

Creates a new NightVision target for scanning.

Parameters:
- `name` (string): Name of the target to create
- `url` (string): URL of the target
- `project` (string, required): Project Name of the target
- `project_id` (string, optional): Project UUID of the target
- `type` (enum: "API" | "WEB", optional, default: "WEB"): Type of the target
- `spec_file` (string, optional): Path to a swagger specification / Postman collection file (for API targets)
- `spec_url` (string, optional): URL to a swagger specification / Postman collection (for API targets)
- `exclude_url` (string[], optional): URL regex patterns to exclude
- `exclude_xpath` (string[], optional): XPath expressions to exclude
- `format` (enum: "text" | "json" | "table", optional, default: "json"): Format of command output

Example commands:
```
Can you create a new NightVision target called "my-test-app" for the URL "https://example.com/app" in the "Web Security" project?
```
```
Can you create a new API target in NightVision with the name "petstore-api" for "https://petstore.swagger.io/v2" in the "API Testing" project using the swagger URL "https://petstore.swagger.io/v2/swagger.json"?
```

#### `delete-target`

Deletes a NightVision target.

Parameters:
- `name` (string): Name of the target to delete
- `project` (string, optional): Project name of the target (disambiguates a name shared across projects)
- `project_id` (string, optional): Project UUID of the target (disambiguates a name shared across projects)
- `format` (enum: "text" | "json" | "table", optional, default: "json"): Format of command output

Example commands:
```
Can you delete my NightVision target called "my-test-app"?
```
```
Can you delete the target named "petstore-api" from project "security-testing"?
```

#### `find-target`

Looks up a target by name across projects. Lighter than `list-targets` — use it before `start-scan` to confirm a target exists and identify its project.

Parameters:
- `name` (string): Target name or partial name to search for

Example command:
```
Can you find my NightVision target named "testphp" and tell me which project it's in?
```

#### `list-additional-paths`

Lists the user-defined additional paths configured for a URL target. These are included in scans alongside discovered paths.

Parameters:
- `target_id` (string): UUID of the target

Example command:
```
Can you list the additional paths configured for target 12345678-1234-1234-1234-123456789012?
```

#### `add-additional-paths`

Adds user-defined paths to a URL target so they are included in future scans.

Parameters:
- `target_id` (string): UUID of the target
- `paths` (string[]): List of URL paths to add (e.g. `["/api/users", "/admin/login"]`)

Example command:
```
Can you add the paths /api/v2/users and /internal/health to target 12345678-1234-1234-1234-123456789012?
```

#### `start-scan`

Initiates a security scan against a NightVision target. The CLI is launched as a managed process (so a local/private Smart Proxy relay stays alive), and the tool waits briefly to resolve and return the scan ID. If the scan ID has not surfaced yet, it returns a `running` status with a pending process key instead of failing, and you can poll `list-scans` / `list-managed-scan-processes` to obtain the ID. This tool always returns structured JSON.

Parameters:
- `target_name` (string): Name of the target to scan
- `auth` (string, optional): Authentication name to use for the scan
- `auth_id` (string, optional): Authentication UUID to use for the scan
- `no_auth` (boolean, optional): Specify to run the scan without authentication
- `project` (string, optional): Project name of the target
- `project_id` (string, optional): Project UUID of the target
- `force_private_scan` (boolean, optional, default: false): Force the CLI Smart Proxy/private scan path; only needed when automatic private-scan detection needs an override
- `run_only_zap_checks` (string[], optional): Run ONLY these ZAP vulnerability checks by name (e.g. `["SQL Injection"]`); all other ZAP checks are disabled. Use `list-check-categories` to see the available names.
- `run_only_nuclei_folders` (string[], optional): Run ONLY these Nuclei template folders by name; all other Nuclei folders are disabled. Use `list-check-categories` to see the available folders.

Example commands:
```
Can you start a scan on my NightVision target called "my-test-app"?
```
```
Can you run a NightVision scan against the "petstore-api" target using the "api-key" authentication?
```
```
Run a scan on "my-test-app" that only checks for SQL Injection and Cross Site Scripting.
```

#### `list-scans`

Lists all scans with optional filtering by target, project, or status.

Parameters:
- `target` (string, optional): Filter scans by target name
- `project` (string, optional): Filter scans by project name
- `project_id` (string, optional): Filter scans by project UUID
- `limit` (number, optional): Maximum number of scans to return
- `status` (enum: "running" | "finished" | "failed" | "all", optional, default: "all"): Filter scans by status
- `format` (enum: "text" | "json" | "table", optional, default: "json"): Format of command output

Example commands:
```
Can you list all my recent NightVision scans?
```
```
Can you show me all running scans for the "my-project" project?
```

#### `get-scan-status`

Retrieves the status and details of a specific scan.

Parameters:
- `scan_id` (string, optional): ID of the scan to get status for
- `target_name` (string, optional): Name of the target to get the latest scan status for
- `project` (string, optional): Project name to filter by when using target_name
- `format` (enum: "text" | "json" | "table", optional, default: "json"): Format of command output

Note: Either `scan_id` or `target_name` must be provided.

Example commands:
```
Can you check the status of my NightVision scan with ID "12345678-1234-1234-1234-123456789012"?
```
```
What's the current progress of the scan I just started on target "my-webapp"?
```

#### `wait-for-scan`

Polls a scan until it reaches a terminal status or the timeout elapses. Prefer `get-scan-status` polling from the agent side unless the MCP client can keep a single tool call open for the full scan duration.

Parameters:
- `scan_id` (string): ID of the scan to wait for
- `timeout_seconds` (number, optional, default: 3600): Maximum seconds to wait for a terminal scan status. DAST scans commonly run longer than 10 minutes.
- `poll_interval_seconds` (number, optional, default: 30): Seconds to wait between status checks
- `format` (enum: "json", optional, default: "json"): Format of command output

Example command:
```
Wait for scan "12345678-1234-1234-1234-123456789012" to finish and tell me the result.
```

#### `get-scan-checks`

Retrieves vulnerabilities and check results found by a specific scan. This tool allows you to see detailed information about security findings and filter results by severity, status, and other criteria.

Parameters:
- `scan_id` (string): ID of the scan to get vulnerability checks for
- `page` (number, optional): Page number for pagination
- `page_size` (number, optional): Number of items per page
- `name` (string, optional): Filter vulnerability checks by name
- `check_kind` (string, optional): Filter vulnerability checks by specific kind
- `severity` (string[], optional): Array of severity levels to filter by. Valid values include: "critical", "high", "medium", "low", "info", "unknown", "unspecified". Defaults to critical, high, medium, low.
- `status` (number[], optional): Array of status codes to filter by. Valid values include: 0 (open), 1 (closed), 2 (false positive), 3 (accepted risk). Defaults to open (0).
- `format` (enum: "text" | "json" | "table", optional, default: "json"): Format of command output

Example commands:
```
Can you show me all vulnerabilities found in my scan with ID "12345678-1234-1234-1234-123456789012"?
```
```
What high severity issues were found in my most recent scan? Use scan ID "87654321-4321-4321-4321-210987654321".
```
```
Could you list only the open SQL injection vulnerabilities from my scan with ID "12345678-1234-1234-1234-123456789012"?
```

Example usage:
```json
{
  "scan_id": "12345678-1234-1234-1234-123456789012",
  "severity": ["high", "critical"],
  "status": [0, 1],
  "page_size": 100,
  "format": "table"
}
```

#### `summarize-scan-findings`

Produces a compact summary of a scan's findings grouped by severity, suitable for reporting the outcome of a scan without flooding the conversation with raw check data.

Parameters:
- `scan_id` (string): ID of the scan to summarize findings for
- `severity` (string[], optional): Severity levels to include. Defaults to critical, high, medium, low.
- `status` (number[], optional): Status codes to include. Defaults to open (0).
- `page_size` (number, optional, default: 100): Number of scan checks to fetch before summarizing
- `limit` (number, optional, default: 20): Maximum number of findings to include in the summary
- `format` (enum: "json", optional, default: "json"): Format of command output

Example command:
```
Summarize the findings from scan "12345678-1234-1234-1234-123456789012".
```

#### `get-scan-paths`

Retrieves all paths (URLs) that have been checked during a specific scan. This helps you understand what endpoints were tested and their status.

Parameters:
- `scan_id` (string): ID of the scan to get checked paths for
- `page` (number, optional): Page number for pagination
- `page_size` (number, optional): Number of items per page
- `filter` (string, optional): Filter string to narrow down the paths
- `format` (enum: "text" | "json" | "table", optional, default: "json"): Format of command output

Example commands:
```
Can you show me all paths that were checked in my scan with ID "12345678-1234-1234-1234-123456789012"?
```
```
What URLs were tested in my last scan? The scan ID is "87654321-4321-4321-4321-210987654321".
```
```
Show me page 2 of the paths checked in my scan with ID "12345678-1234-1234-1234-123456789012" with 20 items per page.
```
```
Can you filter the tested paths containing "/api/" in my scan with ID "12345678-1234-1234-1234-123456789012"?
```

Example usage:
```json
{
  "scan_id": "12345678-1234-1234-1234-123456789012",
  "page": 1,
  "page_size": 50,
  "filter": "/api/",
  "format": "table" 
}
```

#### `list-check-categories`

Lists all available vulnerability checks (ZAP alerts and Nuclei folders) that can be used with the `run_only_zap_checks` / `run_only_nuclei_folders` parameters of `start-scan`. Fetched dynamically from the NightVision API.

Parameters: none

Example command:
```
What vulnerability checks can I run with NightVision?
```

### Findings Tools

#### `list-issues`

Lists security findings for a scan, including HTTP request/response pairs, evidence, payloads, and AI explanations. Sensitive headers and cookies are redacted from the output.

Parameters:
- `scan_id` (string): ID of the scan to get findings for
- `page` (number, optional): Page number for pagination
- `page_size` (number, optional, default: 50): Number of items per page
- `severity` (string[], optional): Filter by severity (`CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, `INFORMATIONAL`, `UNSPECIFIED`)
- `resolution` (number[], optional): Filter by resolution: 0=open, 1=false_positive, 2=resolved, 3=excluded_false_positive
- `kind` (number[], optional): Filter by issue kind IDs
- `filter` (string, optional): Text filter for url_path, parameter_name, or target name
- `format` (enum: "text" | "json" | "table", optional, default: "json"): Format of command output

Example command:
```
Show me the high and critical findings from scan 12345678-1234-1234-1234-123456789012.
```

#### `get-issue-details`

Gets full details for a single finding, including all HTTP request/response pairs (headers, body, cookies), evidence, payload, and AI explanation. Sensitive headers and cookies are redacted.

Parameters:
- `issue_id` (string): UUID of the issue to get full details for
- `format` (enum: "text" | "json" | "table", optional, default: "json"): Format of command output

Example command:
```
Show me the full request and response for finding 12345678-1234-1234-1234-123456789012.
```

#### `get-issue-kind-stats`

Summarizes findings grouped by vulnerability type (kind) for a scan, with counts of open, false-positive, and resolved issues per kind.

Parameters:
- `scan_id` (string): ID of the scan to get issue kind statistics for
- `filter` (string, optional): Text filter for kind names
- `format` (enum: "text" | "json" | "table", optional, default: "json"): Format of command output

Example command:
```
Give me a breakdown of finding types for scan 12345678-1234-1234-1234-123456789012.
```

#### `get-vulnerable-paths`

Lists vulnerable URL paths for a scan, grouped by vulnerability kind.

Parameters:
- `scan_id` (string): ID of the scan to get vulnerable paths for
- `kind` (number[], optional): Filter by issue kind IDs
- `nuclei_template` (string[], optional): Filter by Nuclei template UUIDs
- `resolution` (number[], optional): Filter by resolution: 0=open, 1=false_positive, 2=resolved
- `filter` (string, optional): Text filter for paths

Example command:
```
Which paths are vulnerable in scan 12345678-1234-1234-1234-123456789012?
```

#### `get-issue-occurrences`

Gets individual issue occurrences for a specific URL path and vulnerability kind, showing each payload, parameter, and HTTP status.

Parameters:
- `scan_id` (string): ID of the scan
- `url_path` (string): URL path to get occurrences for
- `http_method` (string): HTTP method (GET, POST, etc.)
- `kind_id` (number, optional): Issue kind ID (required if no `nuclei_template_id`)
- `nuclei_template_id` (string, optional): Nuclei template UUID (required if no `kind_id`)
- `parameter_name` (string, optional): Filter by parameter name
- `resolution` (number[], optional): Filter by resolution: 0=open, 1=false_positive, 2=resolved

Example command:
```
Show me each occurrence of the SQL Injection on /search in scan 12345678-1234-1234-1234-123456789012.
```

### Export Tools

Exports require the scan to be in an exportable state: succeeded, or terminal (failed/aborted) with findings. A still-running scan, or a failed scan with no findings, returns a structured blocker instead of an empty or misleading export file.

#### `export-sarif`

Exports a scan's findings to a SARIF file. Pass the same `project_path` used for the scan so the export can resolve the discovered spec at `.nightvision/openapi.yml` (or `openapi_<lang>.yml`) and attach source traceback. The response also returns the source-linked findings it parsed back from the SARIF (`findings`, `source_linked_count`, `source_linked`), so an agent can report "finding X at file:line" without opening a viewer.

What a finding carries for remediation varies by class. Request-level findings (injection, XSS, and similar) carry a source `file`/`line` plus a `message` with the endpoint, vulnerable parameter, and proof-of-concept payload, enough to locate and fix. The `file`/`line` is the DAST-observable entry point (the endpoint handler), not necessarily the sink, so remediation means opening that line and following the reported parameter into the code that uses it. Response/config-level findings (missing headers, weak auth, error disclosure) come back with `file` null (NightVision emits the web root `/` for these, which is filtered out) or, when they do carry a line, it points at the handler the response was observed through rather than the fix location; fix these in the app's security config, not at the reported line. The SARIF does not include a patch (`fixes`/`codeFlows` are empty); this is a locate-and-fix aid, not an auto-fix.

Parameters:
- `scan_id` (string): ID of the scan to export to SARIF
- `project_path` (string, optional): App source directory used for the scan. Resolves the discovered spec and default output path from this directory; use the same value passed to `run-app-security-scan`
- `output` (string, optional): Output SARIF file path. Defaults to `<project_path>/.nightvision/nightvision-<scan_id>.sarif`
- `output_file` (string, optional): Alias for `output`
- `swagger_file` (string, optional): Explicit OpenAPI/Swagger file for source traceback. Overrides the spec resolved from `project_path`
- `randomize_issue_ids` (boolean, optional, default: false): Randomize issue IDs in the SARIF export
- `format` (enum: "json", optional, default: "json"): Format of command output

Example command:
```
Export the SARIF results for scan "12345678-1234-1234-1234-123456789012".
```

#### `export-csv`

Exports a scan's findings to a CSV file.

Parameters:
- `scan_id` (string): ID of the scan to export to CSV
- `project_path` (string, optional): App source directory used for the scan. Resolves the default output path from this directory; use the same value passed to `run-app-security-scan`
- `output` (string, optional): Output CSV file path. Defaults to `<project_path>/.nightvision/nightvision-<scan_id>.csv`
- `output_file` (string, optional): Alias for `output`
- `format` (enum: "json", optional, default: "json"): Format of command output

### Credential Tools

Authentication credentials are stored per project and assigned to targets so scans can authenticate. Header and cookie values are redacted when credentials are read back.

#### `create-userpass-credential`

This tool is intentionally blocked. Username/password, browser login, OAuth, MFA, and expiring session flows must use Playwright script auth so NightVision can refresh authentication during the scan.

Parameters:
- `name` (string): Name for the credential
- `username` (string): Deprecated
- `password` (string): Deprecated
- `project` (string): Project UUID
- `description` (string, optional): Description

Example command:
```
Save this recorded Playwright login script as a credential called "login-flow" in project <uuid>.
```

#### `create-header-credential`

Creates a header-based credential (e.g. `Authorization: Bearer ...`).

Parameters:
- `name` (string): Name for the credential
- `headers` (object[]): List of `{ name, value }` headers to include in authenticated requests
- `project` (string): Project UUID
- `credential_lifetime` (string): Must be `stable`
- `description` (string, optional): Description

Example command:
```
Create a stable header credential "api-bearer" with Authorization: Bearer xyz in project <uuid>.
```

#### `create-cookie-credential`

Creates a cookie-based credential.

Parameters:
- `name` (string): Name for the credential
- `cookies` (object[]): List of `{ name, value }` cookies to include in authenticated requests
- `project` (string): Project UUID
- `credential_lifetime` (string): Must be `stable`
- `description` (string, optional): Description

Example command:
```
Create a stable cookie credential "service-session" with cookie sid=abc123 in project <uuid>.
```

#### `assign-credential-to-targets`

Assigns a credential to one or more targets so their scans authenticate with it.

Parameters:
- `credential_id` (string): UUID of the credential
- `target_ids` (string[]): List of target UUIDs to assign the credential to

Example command:
```
Assign credential <uuid> to targets <uuid1> and <uuid2>.
```

#### `save-playwright-script`

Saves a previously recorded Playwright script as an authentication credential. Scripts must be recorded through browser interaction (`nightvision auth record ...`), not generated.

Parameters:
- `name` (string): Name for the credential (e.g. "login-flow")
- `script_content` (string): The Playwright script content
- `project` (string): Project UUID to save the credential in
- `script_first_url` (string, optional): The first URL the script navigates to
- `description` (string, optional): Description of the credential

Example command:
```
Save this recorded Playwright login script as a credential called "login-flow" in project <uuid>.
```

#### `update-playwright-script`

Updates an existing Playwright script credential.

Parameters:
- `id` (string): UUID of the credential to update
- `name` (string, optional): New name for the credential
- `script_content` (string, optional): Updated Playwright script content
- `script_first_url` (string, optional): Updated first URL
- `description` (string, optional): Updated description

Example command:
```
Update the script for credential <uuid> with this new recording.
```

#### `get-auth-credential`

Gets details of a credential by UUID, or by name + project. For script credentials, returns the full Playwright script content. Header and cookie values are shown as `[REDACTED]`.

Parameters:
- `id` (string, optional): UUID of the credential
- `name` (string, optional): Name of the credential (requires `project_id`)
- `project_id` (string, optional): Project UUID (required when using `name`)

Example command:
```
Show me the details of credential "login-flow" in project <uuid>.
```

#### `list-auth-credentials`

Lists authentication credentials, optionally filtered by project.

Parameters:
- `project_id` (string, optional): Project UUID to filter by

Example command:
```
List all authentication credentials in project <uuid>.
```

### API Tools

#### `discover-api`

Discovers API endpoints by analyzing source code using the NightVision CLI's `swagger extract` feature. This tool extracts API information from the codebase and generates a Swagger/OpenAPI specification file.

**Before calling this tool, the AI client should:**
1. Identify the programming language of the codebase by checking file extensions or asking the user
2. Ensure all paths provided are absolute paths, not relative paths
3. Confirm the output location for the OpenAPI specification

**If you don't specify the languages:**
The tool will return instructions for analyzing the source code to identify the language. You should examine file extensions and code patterns, then call the tool again with the identified languages.

Parameters:
- `source_paths` (string[]): Absolute paths to code directories to analyze (must be absolute paths, not relative). The provided paths should be used exactly as specified by the user. If not provided, the project root will be used.
- `langs` (enum: "csharp" | "go" | "java" | "js" | "php" | "python" | "ruby" or array of these values): Language(s) of the target code. Must be provided as an array for multi-language projects.
- `target` (string, optional): Target name to upload the swagger file to
- `target_id` (string, optional): Target UUID to upload the swagger file to
- `project` (string, optional): Project name for the swagger extract
- `project_id` (string, optional): Project UUID for the swagger extract
- `output` (string, required): Output file path to store the OpenAPI specs
- `exclude` (string, optional): Files or directories to exclude from analysis (comma-separated, e.g. 'vendor/*,*.json')
- `version` (string, optional, default: "0.1"): Version for the OpenAPI specs
- `no_upload` (boolean, optional, default: true): Skip creation of a new target in the Nightvision API
- `dump_code` (boolean, optional): Include code snippets in the generated spec

Example commands:

```
Can you discover API endpoints in my JavaScript codebase by analyzing the "/Users/username/projects/myapp" directory and save the result to "api-spec.yml"?
```
```
Analyze my Java application in the "/absolute/project/source/code/path" directory to generate an API specification at "./output/openapi.json".
```
```
Discover APIs of the current project, save the results in a file.
```

Example usage (multiple languages):
```json
{
  "source_paths": ["/Users/username/projects/myapp/src/routes", "/Users/username/projects/myapp/src/controllers"],
  "langs": ["js", "python"],
  "output": "./api-spec.yml",
  "target": "my-api-target",
  "project": "my-project",
  "exclude": "node_modules/*,*.test.js",
  "dump_code": true
}
```

**Important Notes**: 
1. When discovering APIs for multiple languages, the tool generates a separate output file per language, appending the language to the base name and keeping the extension (e.g. "api-spec_python.yml" and "api-spec_java.yml").
2. If the output is generated in a temporary location, the tool will provide instructions for moving it to a permanent location.

### Project Tools

#### `list-projects`

Lists all NightVision projects accessible to your account. This tool helps you see all available projects and their basic information.

Parameters:
- `format` (enum: "text" | "json" | "table", optional, default: "json"): Format of command output

Example commands:
```
Can you list all my NightVision projects?
```
```
Show me all the projects I have access to in NightVision as a table.
```

Example usage:
```json
{
  "format": "table"
}
```

#### `get-project-details`

Gets detailed information about a specific NightVision project.

Parameters:
- `name` (string): Name of the project to get details for (required)
- `format` (enum: "text" | "json" | "table", optional, default: "json"): Format of command output

Example commands:
```
Can you show me details about my NightVision project called "Web Security"?
```
```
Get information about the "API Testing" project in NightVision.
```

Example usage:
```json
{
  "name": "Web Security",
  "format": "json"
}
```

### Nuclei Tools

#### `list-nuclei-templates`

Lists all available nuclei templates in NightVision. This tool helps you see what templates are available for use with your targets.

Parameters:
- `project_id` (string, optional): UUID of the project to filter templates by
- `filter` (string, optional): Filter string to narrow down templates by name
- `page` (number, optional): Page number for pagination
- `page_size` (number, optional, default: 100): Number of items per page (defaults to 100)
- `severity` (string[], optional): Array of severity levels to filter by. Valid values include: "critical", "high", "medium", "low", "info", "unknown", "unspecified"
- `target` (string, optional): UUID of the target to filter templates by
- `format` (enum: "text" | "json" | "table", optional, default: "json"): Format of command output

Example commands:
```
Can you list all my custom nuclei templates?
```
```
Show me all nuclei templates in project with ID "2b0636ed-39ce-4348-8836-286b2129bfe0"
```
```
List all high and critical severity nuclei templates for my target
```

Example usage:
```json
{
  "project_id": "2b0636ed-39ce-4348-8836-286b2129bfe0",
  "filter": "sql",
  "page": 1,
  "page_size": 100,
  "severity": ["high", "critical"],
  "target": "87654321-4321-4321-4321-210987654321",
  "format": "table"
}
```

#### `create-nuclei-template`

Creates a new nuclei template record in NightVision. This step is required before uploading a nuclei template file, as it generates the UUID needed for the upload process.

Parameters:
- `name` (string): Name of the nuclei template (required)
- `description` (string, optional): Description of the nuclei template
- `project_id` (string): UUID of the project to associate the template with (required)
- `format` (enum: "text" | "json" | "table", optional, default: "json"): Format of command output

Example commands:
```
Can you create a new nuclei template called "Custom SQL Injection" with description "Detects SQL injection in web forms" with project ID "2b0636ed-39ce-4348-8836-286b2129bfe0"?
```
```
Please create a nuclei template with name "JWT Token Scanner" for project ID "87654321-4321-4321-4321-210987654321".
```

Example usage:
```json
{
  "name": "Custom SQL Injection",
  "description": "Detects SQL injection in web forms",
  "project_id": "2b0636ed-39ce-4348-8836-286b2129bfe0",
  "format": "json"
}
```

#### `upload-nuclei-template`

Uploads a custom nuclei template YAML file to an existing template record in NightVision. **Important: You must first create a template using the `create-nuclei-template` tool to get a template ID.**

Parameters:
- `template_id` (string): ID of the nuclei template to upload to (the template must exist in NightVision)
- `file_path` (string): Path to the YAML file containing the nuclei template (absolute or relative path)
- `project_path` (string, optional): Absolute path to the project directory (for resolving relative file paths)
- `format` (enum: "text" | "json" | "table", optional, default: "json"): Format of command output

Example commands:
```
Can you upload my custom nuclei template from "./templates/sql-injection.yaml" to template ID "12345678-1234-1234-1234-123456789012"?
```
```
Please upload the nuclei template at "/path/to/my/template.yaml" to my NightVision template with ID "87654321-4321-4321-4321-210987654321".
```

Example usage:
```json
{
  "template_id": "12345678-1234-1234-1234-123456789012",
  "file_path": "./templates/sql-injection.yaml",
  "project_path": "/Users/myname/projects/security-templates",
  "format": "json"
}
```

#### `assign-nuclei-template`

Assigns a nuclei template to a target in NightVision. This is a crucial step after creating and uploading a template, as it allows the template to be used in scans against the specified target.

Parameters:
- `target_id` (string): ID of the target to assign the template to (required)
- `template_id` (string): ID of the nuclei template to assign (required)
- `format` (enum: "text" | "json" | "table", optional, default: "json"): Format of command output

Example commands:
```
Can you assign my nuclei template with ID "12345678-1234-1234-1234-123456789012" to target with ID "87654321-4321-4321-4321-210987654321"?
```
```
Please link my custom template "12345678-1234-1234-1234-123456789012" to my target "87654321-4321-4321-4321-210987654321".
```

Example usage:
```json
{
  "target_id": "87654321-4321-4321-4321-210987654321",
  "template_id": "12345678-1234-1234-1234-123456789012",
  "format": "json"
}
```

**Complete Workflow for Nuclei Templates:**

1. First, create a nuclei template record to get its UUID:
   ```
   Can you create a new nuclei template called "Custom SQL Injection" with description "Detects SQL injection in web forms" with project ID "2b0636ed-39ce-4348-8836-286b2129bfe0"?
   ```

2. Then, upload your YAML template file using the returned UUID:
   ```
   Now, please upload my template file from "./templates/custom-sqli.yaml" to the template ID you just created.
   ```

3. Finally, assign the template to a target:
   ```
   Now, assign this template to my target with ID "87654321-4321-4321-4321-210987654321".
   ```

**Path Resolution in Nuclei Template Upload:**

Similar to the API discovery tool, the `upload-nuclei-template` tool supports both relative and absolute paths:

1. **Relative paths** (like `./templates/sql-injection.yaml`):
   - If a `project_path` parameter is provided, the relative path will be resolved against it
   - If no `project_path` is provided, the path will be resolved relative to the current working directory

2. **Absolute paths** (starting with `/`):
   - These are used exactly as provided
   - Example: `/home/user/templates/sql-injection.yaml`

For better accuracy when using relative paths, it's recommended to include the `project_path` parameter with the absolute path to your project directory.

### Traffic Tools

#### `record-traffic`

Records browser traffic for a target using browser automation. This tool opens a browser window where you can interact with the application, then uploads the recorded traffic as a HAR file to NightVision.

Parameters:
- `name` (string): Name for the traffic recording (required)
- `url` (string): URL to record traffic from (required)
- `target` (string): Name of the target (required)
- `project` (string): Name of the project (required)
- `format` (enum: "text" | "json" | "table", optional, default: "text"): Format of command output

Example commands:
```
Can you record my traffic on "https://javaspringvulny.nvtest.io:9000/" for my "javaspringvulny" target in project "ceylan" and name it "login-flow"?
```
```
Record browser traffic for my target application at "https://vulnerable-webapp.com" and save it as "admin-authentication"
```

Example usage:
```json
{
  "name": "login-flow",
  "url": "https://javaspringvulny.nvtest.io:9000/",
  "target": "javaspringvulny",
  "project": "ceylan",
  "format": "text"
}
```

When you run this tool:
1. A browser window will open automatically at the specified URL
2. You'll interact with the application to generate traffic (login, navigate, use features, etc.)
3. When finished, you'll close the browser window
4. The traffic will be automatically recorded as a HAR file and uploaded to NightVision

#### `list-traffic`

Lists all available traffic recordings (HAR files) for a specific target.

Parameters:
- `target` (string): Name of the target (required)
- `project` (string): Name of the project (required)
- `format` (enum: "text" | "json" | "table", optional, default: "json"): Format of command output

Example commands:
```
Can you list all the traffic files for my "javaspringvulny" target in project "ceylan"?
```
```
Show me all the recorded HAR files for the "billing-app" target
```

Example usage:
```json
{
  "target": "javaspringvulny",
  "project": "ceylan",
  "format": "table"
}
```

#### `download-traffic`

Downloads a specific traffic recording (HAR file) for analysis.

**This tool resolves the download directory automatically and never prompts for it.**

When you run this tool, it will:
1. Use the `downloadPath` parameter when it is an absolute, writable directory
2. Otherwise fall back to your home directory, and then to the system temp directory if that is not writable
3. Download the HAR file to the resolved directory
4. Resolve any relative output_file paths against that directory

Parameters:
- `name` (string): Name of the traffic file to download (required)
- `target` (string): Name of the target (required)
- `project` (string): Name of the project (required)
- `downloadPath` (string, optional): Absolute directory path where the file should be downloaded (must be writable)
- `output_file` (string, optional): Path where to save the downloaded HAR file (if not specified, saves as "<name>.har")
- `format` (enum: "text" | "json" | "table", optional, default: "text"): Format of command output

Example commands:
```
Can you download the traffic file named "login-flow" for my "javaspringvulny" target in project "ceylan"?
```
```
Get the "admin-authentication" HAR file and save it to "/tmp/admin-auth.har"
```

Example usage:
```json
{
  "name": "login-flow",
  "target": "javaspringvulny",
  "project": "ceylan",
  "downloadPath": "/Users/username/Downloads",
  "output_file": "login-flow.har",
  "format": "text"
}
```

**Path Resolution in Traffic File Download:**

The download-traffic tool handles paths in the following ways:

1. **downloadPath**: Must be an absolute directory path that exists and is writable
   - If the path is not absolute, the home directory will be used
   - If the path is not writable, the home directory will be used, falling back to the system temp directory if that is also not writable

2. **output_file**:
   - **Relative paths** (like `analysis/login-flow.har`):
     - These are automatically resolved relative to the `downloadPath`
     - For example, with `downloadPath: "/Users/username/Downloads"` and `output_file: "analysis/login-flow.har"`, 
       the file will be saved to `/Users/username/Downloads/analysis/login-flow.har`

   - **Absolute paths** (starting with `/`):
     - These are used exactly as provided
     - Example: `/tmp/traffic.har`

3. **When no output_file is specified**:
   - The file will be saved with the original name in the `downloadPath` directory
   - Example: `{name}.har`

**Complete Workflow for Traffic Recording and Analysis:**

1. First, record traffic using your browser:
   ```
   Can you record my traffic on "https://javaspringvulny.nvtest.io:9000/" for my "javaspringvulny" target in project "ceylan" and name it "login-flow"?
   ```

2. Then, list available recordings to confirm it was saved:
   ```
   List all traffic files for "javaspringvulny" in project "ceylan"
   ```

3. Finally, download a recording for analysis:
   ```
   Download the "login-flow" traffic file for target "javaspringvulny" in project "ceylan" to "/Users/username/Downloads"
   ```

## Development

To run the server in development mode (build and start):

```bash
npm run dev
```

## Limitations

- This is an MVP implementation that focuses on target management and basic scanning functionality
- Authentication is managed through the NightVision CLI, not the MCP server
- Error handling is basic and may not cover all edge cases

## Security Considerations

This server runs NightVision CLI commands and API calls with the permissions of the current user. Be cautious about exposing it to untrusted MCP clients. To report a security issue, see [SECURITY.md](SECURITY.md).

## Troubleshooting

### Common Installation Issues

#### "spawn node ENOENT" Error

If you see an error like `A system error occurred (spawn node ENOENT)` when Claude or Cursor tries to launch the MCP server, it means the `node` command can't be found in the system's PATH. This can happen even if Node.js is installed on your system.

To fix this:

1. **Use absolute path to Node.js**: Modify your MCP configuration to use the full path to the Node.js executable. First, find your Node.js installation path:

   ```bash
   which node
   ```

   Then update your configuration (in Claude for Desktop configuration or Cursor's MCP config):

   ```json
   {
     "mcpServers": {
       "nightvision": {
         "command": "/usr/local/bin/node",  // Replace with your actual node path
         "args": ["/Users/yourusername/path/to/nightvision-mcp/build/index.js"]
       }
     }
   }
   ```

2. **Fix your PATH in the configuration file**: You can add PATH settings in your shell profile files (`.zshrc`, `.bash_profile`, etc.) to ensure Node.js is accessible.

#### Module Not Found Errors

If you see errors related to missing modules:

1. Make sure you've run `npm install` in the project directory
2. Check if you're using the correct Node.js version (22 or later)
3. Try rebuilding the project with `npm run build`

#### Authentication Issues

If you see authentication errors:

1. Run `nightvision login --api-url https://api.nightvision.net/api/v1/` in your terminal to authenticate with the CLI
2. Check if your token is valid and not expired (tokens are stored in `~/.nightvision/token`)

### Connection Issues

If Claude or Cursor can't connect to the MCP server:

1. Make sure the server is running (either as a background process or in a separate terminal)
2. Check that the path to `build/index.js` in your configuration is correct
3. Verify there are no firewall or security settings blocking the connection

### Claude Authentication Issues

If you see errors related to Claude authentication such as:
- "Error refreshing default models: ConnectError: [unauthenticated] Error"
- "Authentication error" or other Claude-specific connection errors

Try the following:

1. **Check your Claude API key/session**:
   - For Claude for Desktop: Sign out and sign back in
   - For Cursor: Make sure your Anthropic API key is correctly set up

2. **Restart the application**:
   - Completely close and reopen Claude for Desktop or Cursor
   - If using a browser-based interface, clear browser cache and reload

3. **Check your internet connection**:
   - Ensure you have a stable internet connection
   - If on a VPN, try disabling it temporarily
   - Check if your corporate network is blocking outbound connections to Anthropic's services

4. **Check service status**:
   - Check if Anthropic's services are experiencing any outages

Note that these authentication errors are specific to the Claude service and are separate from NightVision MCP server authentication.

### Cursor-Specific Troubleshooting

#### Fixing "spawn node ENOENT" in Cursor

If you're using Cursor and seeing the `A system error occurred (spawn node ENOENT)` error, follow these specific steps:

1. **Identify your node path**:
   ```bash
   which node
   ```

2. **Edit your MCP configuration**:
   Create or edit the file `~/.cursor/mcp.json` (or `.cursor/mcp.json` in your project directory):
   ```json
   {
     "mcpServers": {
       "nightvision": {
         "command": "/usr/local/bin/node",  // Replace with the output from 'which node'
         "args": ["/absolute/path/to/nightvision-mcp/build/index.js"]
       }
     }
   }
   ```

3. **Alternative approach using shell wrapper**:
   If the above doesn't work, create a shell script wrapper:
   
   Create a file named `start-nightvision-mcp.sh`:
   ```bash
   #!/bin/bash
   export PATH="/usr/local/bin:$PATH"  # Ensure node is in the PATH
   node /absolute/path/to/nightvision-mcp/build/index.js
   ```
   
   Make it executable:
   ```bash
   chmod +x start-nightvision-mcp.sh
   ```
   
   Update your MCP configuration to use this script:
   ```json
   {
     "mcpServers": {
       "nightvision": {
         "command": "/absolute/path/to/start-nightvision-mcp.sh",
         "args": []
       }
     }
   }
   ```

4. **Verify Node.js installation**:
   If you're still having issues, ensure Node.js is correctly installed:
   ```bash
   node --version
   ```
   
   If the command fails, you may need to reinstall Node.js.

## License

MIT 
