import { execFile } from 'child_process';
import { promisify } from 'util';
import { ENVIRONMENT } from '../config/environment.js';
import { ApiClient } from './api-client.js';
import { serializeRepeatedParams } from '../utils/query-params.js';

// Promisify execFile for cleaner async/await usage
const execFileAsync = promisify(execFile);

/**
 * Authentication and credential operations.
 */
export class AuthService {
  constructor(private client: ApiClient) {}

  /**
   * Create a new authentication token
   * This token can be used for both CLI commands and API requests
   * @param expiryDate Optional expiration date in format YYYY-MM-DD
   * @returns The created token
   */
  async createToken(expiryDate?: string): Promise<string> {
    try {
      // First, attempt to login to NightVision CLI (interactive process)
      try {
        console.error("Attempting to login to NightVision before creating a new token...");
        await execFileAsync('nightvision', ['login', '--api-url', ENVIRONMENT.CURRENT_API_URL]);
        console.error("Login completed successfully.");
      } catch (loginError: any) {
        console.error(`Login attempt encountered an error: ${loginError.message}`);
        // Continue anyway, as the login might have succeeded despite errors in output
      }

      // Now try to create the token (works for both CLI and API)
      const args = ['token', 'create'];

      if (expiryDate) {
        args.push('-d', expiryDate);
      }

      // Skip adding the current token when creating a new token
      const output = await this.client.executeCommand(args, 'text', true);
      const newToken = output.trim().split('\n').pop()?.trim() || '';

      if (!newToken) {
        throw new Error('Failed to create new token. Please manually run: nightvision login --api-url ' + ENVIRONMENT.CURRENT_API_URL);
      }

      // Simple validation of the token format (should be a long string)
      if (newToken.length < 20) {
        console.error(`Warning: Created token has an unexpected format: ${newToken}`);
      }

      console.error(`Successfully created a new authentication token: ${newToken.substring(0, 8)}...`);
      console.error(`This token can be used with both the NightVision CLI and API requests.`);
      return newToken;
    } catch (error: any) {
      // If token creation failed, provide specific instructions
      throw new Error(`${error.message}\n\nPlease manually run the following command in your terminal to authenticate:\nnightvision login --api-url ${ENVIRONMENT.CURRENT_API_URL}`);
    }
  }

  /**
   * Verify that the user is properly authenticated
   * @returns True if authenticated, false otherwise
   */
  async verifyProductionAuth(): Promise<boolean> {
    try {
      // Check if we have a token
      if (!this.client.getToken()) {
        return false;
      }

      try {
        // Make an API request to check authentication
        const response = await this.client.apiRequest<any>('user/me/');

        // Check for nested user object with ID
        return !!(response.user && response.user.id);
      } catch (error) {
        console.error(`Token validation failed: ${error}`);
        return false;
      }
    } catch (error) {
      console.error(`Failed to verify authentication: ${error}`);
      return false;
    }
  }

  /**
   * Ensure the user is authenticated
   * If not authenticated, guide the user to login
   * @returns True if authenticated or successfully logged in, false otherwise
   */
  async ensureProductionAuth(): Promise<boolean> {
    // First check if already authenticated
    if (await this.verifyProductionAuth()) {
      return true;
    }

    // If not authenticated, we need to guide the user to login
    console.error('\n⚠️  Not authenticated.');
    console.error('Please run the following command to login:');
    console.error(`$ nightvision login --api-url ${ENVIRONMENT.CURRENT_API_URL}\n`);

    return false;
  }

  /**
   * Create a username/password credential
   */
  async createUserPassCredential(options: {
    name: string;
    username: string;
    password: string;
    project: string;
    description?: string;
  }): Promise<any> {
    const data: Record<string, any> = {
      name: options.name,
      username: options.username,
      password: options.password,
      project: options.project,
    };
    if (options.description) data.description = options.description;
    return this.client.apiRequest<any>('credentials/username-password/', 'POST', {}, data);
  }

  /**
   * Create a header-based credential
   */
  async createHeaderCredential(options: {
    name: string;
    headers: { name: string; value: string }[];
    project: string;
    description?: string;
  }): Promise<any> {
    const data: Record<string, any> = {
      name: options.name,
      headers: options.headers,
      project: options.project,
    };
    if (options.description) data.description = options.description;
    return this.client.apiRequest<any>('credentials/header/', 'POST', {}, data);
  }

  /**
   * Create a cookie-based credential
   */
  async createCookieCredential(options: {
    name: string;
    cookie: { name: string; value: string }[];
    project: string;
    description?: string;
  }): Promise<any> {
    const data: Record<string, any> = {
      name: options.name,
      cookie: options.cookie,
      project: options.project,
    };
    if (options.description) data.description = options.description;
    return this.client.apiRequest<any>('credentials/cookie/', 'POST', {}, data);
  }

  /**
   * Assign a credential to targets
   */
  async assignCredentialToTargets(credentialId: string, targetIds: string[]): Promise<any> {
    return this.client.apiRequest<any>(`credentials/${encodeURIComponent(credentialId)}/assign-to-targets/`, 'POST', {}, { targets: targetIds });
  }

  /**
   * Create a script-based credential (Playwright recording)
   */
  async createScriptCredential(options: {
    name: string;
    script_content: string;
    script_first_url?: string;
    description?: string;
    project: string;
  }): Promise<any> {
    const data: Record<string, any> = {
      name: options.name,
      script_content: options.script_content,
      project: options.project,
    };
    if (options.script_first_url) data.script_first_url = options.script_first_url;
    if (options.description) data.description = options.description;
    return this.client.apiRequest<any>('credentials/script/', 'POST', {}, data);
  }

  /**
   * Get a credential by UUID
   */
  async getCredential(id: string): Promise<any> {
    return this.client.apiRequest<any>(`credentials/${encodeURIComponent(id)}/`, 'GET');
  }

  /**
   * Get a credential by name within a project
   */
  async getCredentialByName(projectId: string, name: string): Promise<any> {
    return this.client.apiRequest<any>(`projects/${encodeURIComponent(projectId)}/credentials/${encodeURIComponent(name)}/`, 'GET');
  }

  /**
   * List credentials for projects
   */
  async listCredentials(projectIds?: string[]): Promise<any> {
    const params: Record<string, any> = {};
    if (projectIds && projectIds.length > 0) {
      params.project = projectIds;
    }
    return this.client.apiRequest<any>('credentials/', 'GET', params, null, false, serializeRepeatedParams);
  }

  /**
   * Update an existing script-based credential
   */
  async updateScriptCredential(id: string, options: {
    name?: string;
    script_content?: string;
    script_first_url?: string;
    description?: string;
  }): Promise<any> {
    return this.client.apiRequest<any>(`credentials/${encodeURIComponent(id)}/`, 'PUT', {}, options);
  }
}
