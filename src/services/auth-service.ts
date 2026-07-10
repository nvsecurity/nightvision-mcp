import { execFile } from 'child_process';
import { promisify } from 'util';
import { ENVIRONMENT } from '../config/environment.js';
import { ApiClient } from './api-client.js';
import { serializeRepeatedParams } from '../utils/query-params.js';

// Promisify execFile for cleaner async/await usage
const execFileAsync = promisify(execFile);

export interface AuthenticatedUserContext {
  id: string | null;
  email: string | null;
  name: string | null;
  organization: unknown;
  roles: unknown;
  raw: unknown;
}

/**
 * Outcome of validating the current token with the API.
 * - authenticated: a valid user was returned.
 * - unauthenticated: the token is missing, invalid, or rejected (401/403).
 * - error: the check could not be completed (network/DNS/5xx). The token may
 *   still be valid; the caller should not tell the user to re-authenticate.
 */
export type AuthCheckResult =
  | { status: 'authenticated'; user: AuthenticatedUserContext }
  | { status: 'unauthenticated' }
  | { status: 'error'; message: string };

interface CachedUserContext {
  token: string;
  expiresAt: number;
  user: AuthenticatedUserContext;
}

/**
 * Authentication and credential operations.
 */
export class AuthService {
  private userCache: CachedUserContext | null = null;

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
        await execFileAsync(ENVIRONMENT.NIGHTVISION_CLI_PATH, ['login', '--api-url', ENVIRONMENT.CURRENT_API_URL]);
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
        throw new Error(`Failed to create new token. Please manually run: ${ENVIRONMENT.NIGHTVISION_CLI_PATH} login --api-url ${ENVIRONMENT.CURRENT_API_URL}`);
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
      throw new Error(`${error.message}\n\nPlease manually run the following command in your terminal to authenticate:\n${ENVIRONMENT.NIGHTVISION_CLI_PATH} login --api-url ${ENVIRONMENT.CURRENT_API_URL}`);
    }
  }

  /**
   * Verify that the user is properly authenticated
   * @returns True if authenticated, false otherwise
   */
  async verifyProductionAuth(): Promise<boolean> {
    return !!(await this.getAuthenticatedUser());
  }

  /**
   * Return the authenticated NightVision user context after validating the
   * current token with the API.
   */
  async getAuthenticatedUser(forceRefresh = false): Promise<AuthenticatedUserContext | null> {
    try {
      return await this.fetchUserContext(forceRefresh);
    } catch (error) {
      console.error(`Token validation failed: ${error}`);
      this.userCache = null;
      return null;
    }
  }

  /**
   * Core token validation. Returns the user context, null when the token is
   * missing or the API returns no user, and THROWS on a transport/HTTP error
   * (the thrown error carries statusCode/isNetworkError from the api client).
   */
  private async fetchUserContext(forceRefresh: boolean): Promise<AuthenticatedUserContext | null> {
    const token = this.client.getToken();
    if (!token) {
      this.userCache = null;
      return null;
    }

    const now = Date.now();
    if (!forceRefresh && this.userCache?.token === token && this.userCache.expiresAt > now) {
      return this.userCache.user;
    }

    const response = await this.client.apiRequest<any>('user/me/');
    const user = response?.user || response;
    if (!user?.id) {
      this.userCache = null;
      return null;
    }

    const context: AuthenticatedUserContext = {
      id: user.id || null,
      email: user.email || user.username || null,
      name: user.name || user.full_name || null,
      organization: response?.organization || response?.org || user.organization || user.org || null,
      roles: response?.roles || user.roles || null,
      raw: response
    };
    this.userCache = {
      token,
      expiresAt: now + 60_000,
      user: context
    };
    return context;
  }

  /**
   * Validate the current token and return a typed outcome that distinguishes an
   * auth rejection from a connectivity error. Guards use this so a transient
   * network blip is not misreported to the user as an expired token.
   */
  async getAuthenticatedUserResult(forceRefresh = false): Promise<AuthCheckResult> {
    const token = this.client.getToken();
    if (!token) {
      this.userCache = null;
      return { status: 'unauthenticated' };
    }

    const now = Date.now();
    if (!forceRefresh && this.userCache?.token === token && this.userCache.expiresAt > now) {
      return { status: 'authenticated', user: this.userCache.user };
    }

    try {
      const user = await this.fetchUserContext(true);
      return user
        ? { status: 'authenticated', user }
        : { status: 'unauthenticated' };
    } catch (error: any) {
      const statusCode: number | undefined = error?.statusCode;
      // A concrete auth rejection means the token really is bad.
      if (statusCode === 401 || statusCode === 403) {
        return { status: 'unauthenticated' };
      }
      // Anything else (no response, 5xx, DNS) is a connectivity/service error.
      return { status: 'error', message: error?.message || String(error) };
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
    console.error(`$ ${ENVIRONMENT.NIGHTVISION_CLI_PATH} login --api-url ${ENVIRONMENT.CURRENT_API_URL}\n`);

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
