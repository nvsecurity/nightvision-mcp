import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Configuration for token storage
 */
const CONFIG_DIR = path.join(os.homedir(), '.nightvision');
const TOKEN_FILE = path.join(CONFIG_DIR, 'token');

/**
 * Load the token from disk if it exists
 * @returns The loaded token or null if not found
 */
export function loadToken(): string | null {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      return fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    }
  } catch (error) {
    console.error(`Failed to load token: ${error}`);
  }
  return null;
}

/**
 * Save token to disk for persistence between server restarts
 * @param token The token to save
 */
export function saveToken(token: string): void {
  try {
    // Create config directory if it doesn't exist
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    fs.writeFileSync(TOKEN_FILE, token);
  } catch (error) {
    console.error(`Failed to save token: ${error}`);
  }
}

/**
 * Clear the saved token from disk
 */
export function clearToken(): void {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      fs.unlinkSync(TOKEN_FILE);
    }
  } catch (error) {
    console.error(`Failed to clear token: ${error}`);
  }
} 