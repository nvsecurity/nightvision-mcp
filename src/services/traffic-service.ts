import { ApiClient } from './api-client.js';
import type { OutputFormat } from './api-client.js';

/**
 * Traffic recording, listing and download operations.
 */
export class TrafficService {
  constructor(private client: ApiClient) {}

  /**
   * Record traffic for a target using browser automation
   * @param name Name for the traffic recording
   * @param url URL to record traffic from
   * @param target Target name
   * @param project Project name
   * @param format Output format
   * @returns Result of the recording operation
   */
  async recordTraffic(
    name: string,
    url: string,
    target: string,
    project: string,
    format: OutputFormat = 'text'
  ): Promise<string> {
    try {
      console.error(`Recording traffic from ${url} for target ${target} in project ${project} with name ${name}...`);

      // Validate required parameters
      if (!name || name.trim() === '') {
        throw new Error("Recording name is required");
      }

      if (!url || url.trim() === '') {
        throw new Error("URL is required");
      }

      if (!target || target.trim() === '') {
        throw new Error("Target name is required");
      }

      if (!project || project.trim() === '') {
        throw new Error("Project name is required");
      }

      // Build CLI command
      const args = ['traffic', 'record', name, url, '--target', target, '--project', project];

      // Execute the command
      // Note: This will open a browser window that the user will interact with and then close
      console.error(`Executing traffic record command. A browser window will open for recording...`);
      console.error(`After recording (closing the browser), the HAR file will be automatically uploaded to NightVision.`);

      const result = await this.client.executeCommand(args, format);

      console.error(`Traffic recording completed successfully.`);

      return result;
    } catch (error: any) {
      console.error(`Error recording traffic: ${error.message}`);

      // Check for common errors
      if (error.message.includes('browser failed')) {
        throw new Error(`Browser automation failed. Please check that you have a compatible browser installed.`);
      }

      if (error.message.includes('not found') && error.message.includes('target')) {
        throw new Error(`Target "${target}" not found. Please check that the target exists in the specified project.`);
      }

      if (error.message.includes('not found') && error.message.includes('project')) {
        throw new Error(`Project "${project}" not found. Please check that the project exists and you have access to it.`);
      }

      throw new Error(`Failed to record traffic: ${error.message}`);
    }
  }

  /**
   * List traffic files for a target
   * @param target Target name
   * @param project Project name
   * @param format Output format
   * @returns List of traffic files
   */
  async listTraffic(
    target: string,
    project: string,
    format: OutputFormat = 'json'
  ): Promise<string> {
    try {
      console.error(`Listing traffic files for target ${target} in project ${project}...`);

      // Validate required parameters
      if (!target || target.trim() === '') {
        throw new Error("Target name is required");
      }

      if (!project || project.trim() === '') {
        throw new Error("Project name is required");
      }

      // Build CLI command
      const args = ['traffic', 'list', target, '--project', project];

      // Execute the command
      const result = await this.client.executeCommand(args, format);

      return result;
    } catch (error: any) {
      console.error(`Error listing traffic files: ${error.message}`);

      // Check for common errors
      if (error.message.includes('not found') && error.message.includes('target')) {
        throw new Error(`Target "${target}" not found. Please check that the target exists in the specified project.`);
      }

      if (error.message.includes('not found') && error.message.includes('project')) {
        throw new Error(`Project "${project}" not found. Please check that the project exists and you have access to it.`);
      }

      throw new Error(`Failed to list traffic files: ${error.message}`);
    }
  }

  /**
   * Download a traffic file (HAR) for a target
   * @param name Name of the traffic file to download
   * @param target Target name
   * @param project Project name
   * @param outputFile Optional path where to save the downloaded HAR file
   * @param downloadPath Optional path to download the file to
   * @param format Output format
   * @returns Result of the download operation
   */
  async downloadTraffic(
    name: string,
    target: string,
    project: string,
    outputFile?: string,
    downloadPath?: string,
    format: OutputFormat = 'text'
  ): Promise<string> {
    try {
      console.error(`Downloading traffic file ${name} for target ${target} in project ${project}...`);

      // Validate required parameters
      if (!name || name.trim() === '') {
        throw new Error("Traffic file name is required");
      }

      if (!target || target.trim() === '') {
        throw new Error("Target name is required");
      }

      if (!project || project.trim() === '') {
        throw new Error("Project name is required");
      }

      // Import required modules
      const fs = await import('fs/promises');
      const path = await import('path');
      const os = await import('os');

      // Ensure we have a valid, writable download path
      if (!downloadPath || downloadPath.trim() === '') {
        downloadPath = os.tmpdir();
        console.error(`No download path provided, using temp directory: ${downloadPath}`);
      }

      // Create a temporary directory for the download
      const tempDownloadDir = path.join(downloadPath, 'nightvision-downloads');
      await fs.mkdir(tempDownloadDir, { recursive: true });

      // The CLI downloads into the temp dir, set as the child's working directory.

      // Build CLI command
      const args = ['traffic', 'download', name, '--target', target, '--project', project];

      // Execute the command to download the file
      const result = await this.client.executeCommand(args, format, false, tempDownloadDir);

      // Default download location will be the temp directory with the name of the file
      const tempFilePath = path.join(tempDownloadDir, `${name}.har`);

      // Verify the file was downloaded
      try {
        await fs.access(tempFilePath);
      } catch (err) {
        throw new Error(`Failed to download the file. The file was not found at ${tempFilePath}.`);
      }

      // Move the file to the final output path if specified
      let finalOutputPath = tempFilePath;

      if (outputFile && outputFile.trim() !== '') {
        try {
          // Create the target directory if needed
          const outputDir = path.dirname(outputFile);
          await fs.mkdir(outputDir, { recursive: true });

          // Copy the file to the destination
          await fs.copyFile(tempFilePath, outputFile);

          // Successful copy, use the outputFile as the final path
          finalOutputPath = outputFile;
          console.error(`Copied traffic file from ${tempFilePath} to ${finalOutputPath}`);

          // Remove the temporary file
          await fs.unlink(tempFilePath);
        } catch (err) {
          console.error(`Error copying file to final destination: ${err}`);
          console.error(`Keeping the file at temporary location: ${tempFilePath}`);
          // Keep the fallback path
        }
      }

      console.error(`Traffic file downloaded successfully to: ${finalOutputPath}`);

      return result;
    } catch (error: any) {
      console.error(`Error downloading traffic file: ${error.message}`);

      // Check for common errors
      if (error.message.includes('not found') && error.message.includes('traffic')) {
        throw new Error(`Traffic file "${name}" not found. Please check the name and use the list-traffic tool to see available files.`);
      }

      if (error.message.includes('not found') && error.message.includes('target')) {
        throw new Error(`Target "${target}" not found. Please check that the target exists in the specified project.`);
      }

      if (error.message.includes('not found') && error.message.includes('project')) {
        throw new Error(`Project "${project}" not found. Please check that the project exists and you have access to it.`);
      }

      throw new Error(`Failed to download traffic file: ${error.message}`);
    }
  }
}
