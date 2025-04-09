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
   git clone https://github.com/yourusername/nightvision-mcp-server.git
   cd nightvision-mcp-server
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the TypeScript code:
   ```bash
   npm run build
   ```

## Usage

### Starting the server

```bash
npm start
```

### Authentication

The NightVision MCP Server requires authentication to interact with the NightVision API. You have three options for authentication:

1. **Use an existing token** - If you already have a NightVision API token, you can provide it to the server.
2. **Create a new token** - The server can create a new token for you using the NightVision CLI.
3. **Use the token saved from a previous session** - Tokens are stored locally for convenience.

#### Using the Authentication Tool

The server provides an `authenticate` tool that can be used from any MCP client (Claude Desktop, Cursor, etc.):

```
Can you authenticate with NightVision? I need to create a new token.
```

Or to use an existing token:

```
Can you authenticate with NightVision using token "YOUR_TOKEN_HERE"?
```

To check current authentication status:

```
Can you check if I'm authenticated with NightVision?
```

#### Token Storage

Authentication tokens are stored in `~/.nightvision/token` on your machine. This allows the server to remain authenticated between restarts.

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
         "args": ["/absolute/path/to/build/nightvision-mcp-server.js"]
       }
     }
   }
   ```

3. Restart Claude for Desktop

### Using with Cursor

1. Configure the MCP server integration by adding it to one of the following locations:

   - **Project Configuration** (recommended for project-specific use):  
     Create a `.cursor/mcp.json` file in your project directory with the following content:
     ```json
     {
       "mcpServers": {
         "nightvision": {
           "command": "node",
           "args": ["/absolute/path/to/build/nightvision-mcp-server.js"]
         }
       }
     }
     ```

   - **Global Configuration** (for use across all projects):  
     Create a `~/.cursor/mcp.json` file in your home directory with the same content as above.

2. Restart Cursor or reload the window

3. The NightVision tools will now be available to Cursor's AI assistant

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
- `project` (string, optional): Project Name of the target
- `project_id` (string, optional): Project UUID of the target
- `format` (enum: "text" | "json" | "table", optional, default: "json"): Format of command output

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

**This tool now prompts for your project path before analyzing the code.**

When you run this tool, it will:
1. First ask you to confirm your absolute project directory path
2. After you provide the path, it will analyze your code using that path for resolving relative paths

Parameters:
- `source_paths` (string[]): Paths to code directories to analyze (both absolute and relative paths are supported)
- `lang` (enum: "csharp" | "go" | "java" | "js" | "python" | "ruby"): Language of the target code
- `target` (string, optional): Target name to upload the swagger file to
- `target_id` (string, optional): Target UUID to upload the swagger file to
- `project` (string, optional): Project name for the swagger extract
- `project_id` (string, optional): Project UUID for the swagger extract
- `output` (string, required): Output file path to store the OpenAPI specs
- `exclude` (string, optional): Files or directories to exclude from analysis (comma-separated, e.g. 'vendor/*,*.json')
- `version` (string, optional, default: "0.1"): Version for the OpenAPI specs
- `no_upload` (boolean, optional, default: true): Skip creation of a new target in the Nightvision API
- `dump_code` (boolean, optional): Include code snippets in the generated spec
- `verbose` (boolean, optional, default: false): Enable verbose output for detailed debugging information
- `format` (enum: "text" | "json" | "table", optional, default: "text"): Format of command output

Example commands:
```
Can you discover API endpoints in my JavaScript codebase by analyzing the "./src/routes" directory and save the result to "api-spec.yml"?
```
```
Please analyze my Java application in the "./src/controllers" directory to generate an API specification at "./output/openapi.json" and link it to my "my-api" target.
```

Example usage:
```json
{
  "source_paths": ["./src/routes", "./src/controllers"],
  "lang": "js",
  "output": "./api-spec.yml",
  "target": "my-api-target",
  "project": "my-project",
  "exclude": "node_modules/*,*.test.js",
  "dump_code": true
}
```

**Path Resolution in API Discovery:**

The `discover-api` tool now interactively asks for your project path to ensure accurate path resolution.

When you invoke the tool, it will prompt you for the absolute path to your project directory. This ensures that:
1. Relative paths are resolved correctly even if the MCP server has a different working directory
2. All file operations use the correct base directory
3. You don't have to worry about where the server is running from

After providing your project path, the tool supports both relative and absolute paths for both source code and output files:

1. **Relative paths** (like `./src/routes` or `./output/api-spec.yml`):
   - These are automatically resolved relative to your provided project path
   - For example, `./src/routes` will resolve to `/your/provided/project/path/src/routes`
   - Especially useful for analyzing the current project and storing outputs in the project directory

2. **Absolute paths** (starting with `/`):
   - These are used exactly as provided
   - Example: `/home/user/project/src/routes`

The **required** `output` parameter works the same way:
   - Relative paths: `"output": "./api/openapi.yml"` will save in your specified project directory
   - Absolute paths: `"output": "/tmp/openapi.yml"` will save to the absolute location

In both cases, the tool will:
- Automatically resolve paths to absolute paths
- Show the path resolution in the output
- Write the OpenAPI spec to the specified location if writable

> **Note**: The server will automatically handle permissions issues and redirect output to writable locations when needed.

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

## License

MIT 