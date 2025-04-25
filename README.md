# NightVision MCP Server

A Model Context Protocol (MCP) server that enables AI assistants to interact with the NightVision security platform, providing comprehensive capabilities for security testing, scanning, template management, and vulnerability analysis.

## Features

- List NightVision targets with filtering options
- Get detailed information about specific targets
- Create new targets with customizable options
- Delete targets when they are no longer needed
- Start security scans against targets
- Track scan status and view results
- View and filter vulnerabilities found in security scans
- Discover API endpoints for API targets
- Upload custom nuclei templates for targeted vulnerability scanning
- Integration with Claude and other MCP-compatible assistants

## Prerequisites

- Node.js 16+
- NightVision CLI installed and configured
- Valid NightVision account and authentication

## Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/NimblerSecurity/nightvision-mcp.git
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
         "args": ["/absolute/path/to/build/index.js"]
       }
     }
   }
   ```

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
- `format` (enum: "text" | "json" | "table", optional, default: "json"): Format of command output

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

Example commands:
```
Can you delete my NightVision target called "my-test-app"?
```
```
Can you delete the target named "petstore-api" from project "security-testing"?
```

#### `start-scan`

Initiates a security scan against a NightVision target. The scan runs asynchronously in the background.

Parameters:
- `target_name` (string): Name of the target to scan
- `auth` (string, optional): Authentication name to use for the scan
- `auth_id` (string, optional): Authentication UUID to use for the scan
- `no_auth` (boolean, optional): Specify to run the scan without authentication
- `project` (string, optional): Project name of the target
- `project_id` (string, optional): Project UUID of the target
- `format` (enum: "text" | "json" | "table", optional, default: "json"): Format of command output

Example commands:
```
Can you start a scan on my NightVision target called "my-test-app"?
```
```
Can you run a NightVision scan against the "petstore-api" target using the "api-key" authentication?
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

#### `get-scan-checks`

Retrieves vulnerabilities and check results found by a specific scan. This tool allows you to see detailed information about security findings and filter results by severity, status, and other criteria.

Parameters:
- `scan_id` (string): ID of the scan to get vulnerability checks for
- `page` (number, optional): Page number for pagination
- `page_size` (number, optional, default: 100): Number of items per page (defaults to 100)
- `check_kind` (string, optional): Filter vulnerability checks by specific kind
- `severity` (string[], required): Array of severity levels to filter by. Valid values include: "critical", "high", "medium", "low", "info", "unknown", "unspecified"
- `status` (number[], required): Array of status codes to filter by. Valid values include: 0 (open), 1 (closed), 2 (false positive), 3 (accepted risk)
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
- `langs` (enum: "csharp" | "go" | "java" | "js" | "python" | "ruby" or array of these values): Language(s) of the target code. Must be provided as an array for multi-language projects.
- `target` (string, optional): Target name to upload the swagger file to
- `target_id` (string, optional): Target UUID to upload the swagger file to
- `project` (string, optional): Project name for the swagger extract
- `project_id` (string, optional): Project UUID for the swagger extract
- `output` (string, required): Output file path to store the OpenAPI specs
- `exclude` (string, optional): Files or directories to exclude from analysis (comma-separated, e.g. 'vendor/*,*.json')
- `version` (string, optional, default: "0.1"): Version for the OpenAPI specs
- `no_upload` (boolean, optional, default: true): Skip creation of a new target in the Nightvision API
- `dump_code` (boolean, optional): Include code snippets in the generated spec
- `verbose` (boolean, optional, default: false): Enable verbose output for detailed information about the API discovery process
- `format` (enum: "text" | "json" | "table", optional, default: "text"): Format of command output

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
1. When discovering APIs for multiple languages, the tool will generate separate output files for each language with names like "openapi-crapi-discovered_python$1" and "openapi-crapi-discovered_java$1" (where $1 is a sequence number).
2. These generated files will NOT have file extensions even though they contain YAML content. You'll need to manually add ".yml" extensions to these files.
3. If the output is generated in a temporary location, the tool will provide instructions for moving it to a permanent location.

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

**This tool will use the provided downloadPath or interactively ask for a writable directory path before downloading the file.**

When you run this tool, it will:
1. Use the `downloadPath` parameter if provided in the initial request, or ask you to provide one
2. Validate that the directory is absolute and writable
3. Download the HAR file to the specified directory
4. Resolve any relative output_file paths against the download directory

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
   - If the path is not writable, the system temp directory will be used

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

This server runs NightVision CLI commands with the permissions of the current user. Be cautious when exposing this functionality to models, as it could potentially execute arbitrary commands if not properly restricted.

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
2. Check if you're using the correct Node.js version (16+)
3. Try rebuilding the project with `npm run build`

#### Authentication Issues

If you see authentication errors:

1. Run `nightvision login --api-url https://api.nightvision.net` in your terminal to authenticate with the CLI
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

