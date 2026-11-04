/**
 * Environment configuration
 */

/**
 * NightVision API configuration
 */
export const NIGHTVISION_API = {
  /**
   * Production API URL.
   *
   * NV-6111: CLI 0.26.0 or later supports this host and maps Smart Proxy
   * connections to the existing relay hosts on nightvision.net.
   */
  PRODUCTION_URL: 'https://api.nightviz.ai/api/v1/'
};

/**
 * Environment settings
 */
export const ENVIRONMENT = {
  /**
   * Current API environment to use
   */
  CURRENT_API_URL: process.env.NIGHTVISION_API_URL || NIGHTVISION_API.PRODUCTION_URL,

  /**
   * NightVision CLI executable. MCP desktop clients may launch without the
   * user's interactive shell PATH, so allow an explicit absolute path.
   */
  NIGHTVISION_CLI_PATH: process.env.NIGHTVISION_CLI_PATH || 'nightvision'
};
