import { createServer, connectServer } from './core/index.js';
import { nightvisionService } from './services/index.js';
import { loadToken } from './config/index.js';
import { registerAuthTools, registerTargetTools, registerScanTools, registerExportTools, registerPreflightTools, registerHarnessTools, registerDoctorTools, registerApiTools, registerNucleiTools, registerProjectTools, registerTrafficTools, registerFindingTools } from './tools/index.js';
import { ENVIRONMENT } from './config/environment.js';
import { isCliVersionBelow, MIN_CLI_VERSION } from './utils/cli-version.js';

/**
 * Main application entry point
 */
async function main() {
  try {
    // Check if NightVision is installed
    if (!await nightvisionService.isInstalled()) {
      console.error(`ERROR: NightVision CLI not found at "${ENVIRONMENT.NIGHTVISION_CLI_PATH}". Please install NightVision, add it to PATH, or set NIGHTVISION_CLI_PATH.`);
      process.exit(1);
    }

    // Warn (but do not block) when the installed CLI is older than the minimum
    // this server relies on. A dev build with no parseable version is left alone.
    const cliVersion = await nightvisionService.getCliVersion();
    if (cliVersion && isCliVersionBelow(cliVersion, MIN_CLI_VERSION)) {
      console.error(`WARNING: NightVision CLI ${cliVersion} is older than the supported minimum ${MIN_CLI_VERSION}. Some tools (for example API discovery) may fail; please upgrade the NightVision CLI.`);
    }

    // Load authentication token
    const token = loadToken();
    if (token) {
      nightvisionService.setToken(token);
      console.error(`Loaded authentication token: ${token.substring(0, 8)}...`);
      
      // Verify the token, distinguishing an invalid/expired token from a
      // transient API outage. The boolean verifyProductionAuth collapses both
      // into false, which made a startup-time outage print the "invalid or
      // expired" advice and send the user to re-login. Use the same
      // getAuthenticatedUserResult tri-state the rest of the server adopted so an
      // outage is not misdiagnosed as a bad token.
      const authCheck = await nightvisionService.getAuthenticatedUserResult();
      if (authCheck.status === 'authenticated') {
        console.error("Successfully verified authentication.");
      } else if (authCheck.status === 'error') {
        console.error(`WARNING: Could not verify authentication; the NightVision API was unreachable: ${authCheck.message}`);
        console.error("This is likely a transient outage rather than a bad token. The server will start; tools will retry the API.");
      } else {
        console.error("WARNING: Your authentication token appears to be invalid or expired.");
        console.error(`If you encounter authentication issues, please run: ${ENVIRONMENT.NIGHTVISION_CLI_PATH} login --api-url ${ENVIRONMENT.CURRENT_API_URL}`);
      }
    } else {
      console.error("No authentication token found. You will need to authenticate to use the tools.");
      console.error(`Please run: ${ENVIRONMENT.NIGHTVISION_CLI_PATH} login --api-url ${ENVIRONMENT.CURRENT_API_URL}`);
    }
    
    // Create and initialize MCP server
    const server = createServer();
    
    // Register tools
    registerAuthTools(server);
    registerTargetTools(server);
    registerScanTools(server);
    registerExportTools(server);
    registerPreflightTools(server);
    registerHarnessTools(server);
    registerDoctorTools(server);
    registerApiTools(server);
    registerNucleiTools(server);
    registerProjectTools(server);
    registerTrafficTools(server);
    registerFindingTools(server);

    // Start the server
    await connectServer(server);
    
    console.error("NightVision MCP Server running...");
    console.error(`IMPORTANT: This server connects to the NightVision API at ${ENVIRONMENT.CURRENT_API_URL}`);
  } catch (error: any) {
    console.error(`Failed to start MCP server: ${error.message}`);
    process.exit(1);
  }
}

// Run the application
main().catch(error => {
  console.error(`Unhandled error: ${error}`);
  process.exit(1);
});
