import { createServer, connectServer } from './core/index.js';
import { nightvisionService } from './services/index.js';
import { loadToken } from './config/index.js';
import { registerAuthTools, registerTargetTools, registerScanTools, registerApiTools, registerNucleiTools, registerProjectTools, registerTrafficTools } from './tools/index.js';
import { ENVIRONMENT } from './config/environment.js';

/**
 * Main application entry point
 */
async function main() {
  try {
    // Check if NightVision is installed
    if (!await nightvisionService.isInstalled()) {
      console.error("ERROR: NightVision CLI not found. Please install NightVision and make sure it's in your PATH.");
      process.exit(1);
    }
    
    // Load authentication token
    const token = loadToken();
    if (token) {
      nightvisionService.setToken(token);
      console.error(`Loaded authentication token: ${token.substring(0, 8)}...`);
      
      // Verify the token works with production environment
      if (!await nightvisionService.verifyProductionAuth()) {
        console.error("WARNING: Your authentication token appears to be invalid or expired.");
        console.error(`If you encounter authentication issues, please run: nightvision login --api-url ${ENVIRONMENT.CURRENT_API_URL}`);
      } else {
        console.error("Successfully verified authentication.");
      }
    } else {
      console.error("No authentication token found. You will need to authenticate to use the tools.");
      console.error(`Please run: nightvision login --api-url ${ENVIRONMENT.CURRENT_API_URL}`);
    }
    
    // Create and initialize MCP server
    const server = createServer();
    
    // Register tools
    registerAuthTools(server);
    registerTargetTools(server);
    registerScanTools(server);
    registerApiTools(server);
    registerNucleiTools(server);
    registerProjectTools(server);
    registerTrafficTools(server);
    
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