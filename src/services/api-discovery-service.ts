import { Semaphore } from '../utils/semaphore.js';
import { languageOutputPath } from '../utils/output-naming.js';
import { resolveActualOutputFile } from '../utils/discover-output-path.js';
import { ApiClient } from './api-client.js';
import type { OutputFormat } from './api-client.js';

/**
 * Cap the number of simultaneous `nightvision swagger extract` subprocesses
 * (each runs the heavy api-excavator engine). Running many at once under the
 * single server process can exhaust local memory, CPU, and file descriptors.
 * Override the limit with the NIGHTVISION_EXTRACT_CONCURRENCY environment variable.
 */
const MAX_EXTRACT_CONCURRENCY = Math.max(
  1,
  Number(process.env.NIGHTVISION_EXTRACT_CONCURRENCY) || 4
);
const extractLimiter = new Semaphore(MAX_EXTRACT_CONCURRENCY);

/**
 * API discovery via `nightvision swagger extract`.
 */
export class ApiDiscoveryService {
  constructor(private client: ApiClient) {}

  /**
   * Discover API endpoints for a target by analyzing source code
   * @param sourcePaths Array of paths to the source code to analyze
   * @param options Additional options for API discovery
   * @param format Output format
   * @param projectPath Explicit project path to use for resolving relative paths
   * @returns Discovered API endpoints information
   */
  async discoverApi(
    sourcePaths: string[],
    options: {
      lang: 'csharp' | 'go' | 'java' | 'js' | 'php' | 'python' | 'ruby' | Array<'csharp' | 'go' | 'java' | 'js' | 'php' | 'python' | 'ruby'>;
      target?: string;
      target_id?: string;
      project?: string;
      project_id?: string;
      output: string;
      exclude?: string;
      version?: string;
      no_upload?: boolean;
      dump_code?: boolean;
    },
    format: OutputFormat = 'text',
    projectPath: string
  ): Promise<string> {
    try {
      console.error(`Discovering API endpoints for source code using swagger extract...`);

      // Import required modules
      const fs = await import('fs');
      const path = await import('path');
      const os = await import('os');

      // Use the provided project path for resolving all relative paths
      const workspacePath = projectPath;

      // Log the workspace paths for debugging
      console.error(`Using project path: ${workspacePath}`);
      console.error(`Current working directory: ${process.cwd()}`);

      // Convert any relative source paths to absolute paths
      const absoluteSourcePaths = sourcePaths.map(sourcePath => {
        if (!sourcePath.startsWith('/')) {
          const absolutePath = path.resolve(workspacePath, sourcePath);
          console.error(`Converting relative path '${sourcePath}' to absolute path '${absolutePath}'`);
          return absolutePath;
        }
        return sourcePath;
      });

      // Handle single language or multiple languages
      let languages: Array<'csharp' | 'go' | 'java' | 'js' | 'php' | 'python' | 'ruby'>;

      if (Array.isArray(options.lang)) {
        languages = options.lang;
        console.error(`Multiple languages requested: ${languages.join(', ')}`);
      } else if (options.lang) {
        languages = [options.lang];
        console.error(`Single language requested: ${options.lang}`);
      } else {
        throw new Error("Language is required for API discovery");
      }

      // Validate languages
      if (languages.length === 0) {
        throw new Error("At least one language must be specified for API discovery");
      }

      // Build the CLI command arguments based on the NightVision CLI
      const args = ['swagger', 'extract', ...absoluteSourcePaths];

      // Add output file name with absolute path to a writable directory
      // Lazily create a unique per-call temp directory for output redirects, so
      // concurrent discoveries that share an output base name do not collide.
      let tempDir: string | null = null;
      const redirectDir = (): string => {
        if (tempDir === null) {
          tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nightvision-discover-'));
        }
        return tempDir;
      };
      let outputFile: string;

      // Handle absolute or relative output paths
      if (options.output.startsWith('/')) {
        // If it's trying to write to root directory, redirect to tmp
        const dirname = path.dirname(options.output);
        const basename = path.basename(options.output);

        if (dirname === '/' || !fs.existsSync(dirname)) {
          outputFile = path.join(redirectDir(), basename);
          console.error(`Warning: Redirecting output from ${options.output} to ${outputFile} due to potential permissions issues`);
        } else {
          outputFile = options.output;
        }
      } else {
        // If relative path, convert to absolute using workspace path
        outputFile = path.resolve(workspacePath, options.output);
        console.error(`Converting relative output path '${options.output}' to absolute path '${outputFile}'`);
      }

      // Test if the output directory is writable
      try {
        const testDir = path.dirname(outputFile);
        fs.accessSync(testDir, fs.constants.W_OK);
      } catch (err) {
        console.error(`Output directory is not writable, redirecting to temp directory`);
        outputFile = path.join(redirectDir(), path.basename(outputFile));
      }

      // The CLI defaults to YAML and ignores the output extension, so derive the
      // file format from the requested extension and pass it explicitly; a
      // .json request then actually produces JSON rather than YAML (NV-4473).
      const fileFormat = /\.json$/i.test(outputFile) ? 'json' : 'yml';

      // For multiple languages, we need to run the command multiple times
      // and merge the results
      if (languages.length > 1) {
        // Use a different output file for each language
        const results: string[] = [];
        const outputs: string[] = [];

        for (const lang of languages) {
          const langOutputFile = languageOutputPath(outputFile, lang);
          console.error(`Processing language: ${lang} with output: ${langOutputFile}`);

          // Build command arguments for this language
          const langArgs = [...args];

          // Add language option
          langArgs.push('--lang', lang);

          // Add target information if provided
          if (options.target) {
            langArgs.push('--target', options.target);
          }

          if (options.target_id) {
            langArgs.push('--target-id', options.target_id);
          }

          // Add project information if provided
          if (options.project) {
            langArgs.push('--project', options.project);
          }

          if (options.project_id) {
            langArgs.push('--project-id', options.project_id);
          }

          // Add the vetted output file and the matching file format
          langArgs.push('--output', langOutputFile);
          langArgs.push('--file-format', fileFormat);

          // Add exclude patterns if provided
          if (options.exclude) {
            langArgs.push('--exclude', options.exclude);
          }

          // Add version if provided
          if (options.version) {
            langArgs.push('--version', options.version);
          }

          // Add no-upload flag (default to true for safety)
          if (options.no_upload !== false) {
            langArgs.push('--no-upload');
          }

          // Add dump-code flag if requested
          if (options.dump_code) {
            langArgs.push('--dump-code');
          }

          try {
            // Execute the CLI command for this language (concurrency-limited)
            const result = await extractLimiter.run(() => this.client.executeCommand(langArgs, format));
            results.push(`🔍 Language: ${lang}\n${result}`);
            // Report the file the CLI actually wrote, not the requested path:
            // the CLI forces a .yml extension on its YAML output (NV-4473).
            const langActual = resolveActualOutputFile(langOutputFile, fs.existsSync);
            if (langActual) {
              outputs.push(langActual);
            }
          } catch (cliError: any) {
            // Log the error but continue with other languages
            const errorMessage = cliError.message;
            console.error(`Error discovering API for language ${lang}: ${errorMessage}`);
            results.push(`❌ Language: ${lang}\n${errorMessage}`);
          }
        }

        // Combine the results
        const combinedResult = results.join('\n\n---\n\n');
        const outputInfo = outputs.length
          ? `\nOpenAPI Specification Files:\n${outputs.map(o => `- ${o}`).join('\n')}`
          : `\nNo OpenAPI specification files were produced.`;

        return combinedResult + outputInfo;
      } else {
        // Single language processing (original implementation)
        // Add mandatory language option
        args.push('--lang', languages[0]);

        // Add target information if provided
        if (options.target) {
          args.push('--target', options.target);
        }

        if (options.target_id) {
          args.push('--target-id', options.target_id);
        }

        // Add project information if provided
        if (options.project) {
          args.push('--project', options.project);
        }

        if (options.project_id) {
          args.push('--project-id', options.project_id);
        }

        // Add the vetted output file and the matching file format
        args.push('--output', outputFile);
        args.push('--file-format', fileFormat);

        // Add exclude patterns if provided
        if (options.exclude) {
          args.push('--exclude', options.exclude);
        }

        // Add version if provided
        if (options.version) {
          args.push('--version', options.version);
        }

        // Add no-upload flag (default to true for safety)
        if (options.no_upload !== false) {
          args.push('--no-upload');
        }

        // Add dump-code flag if requested
        if (options.dump_code) {
          args.push('--dump-code');
        }

        try {
          // Execute the CLI command (concurrency-limited)
          const result = await extractLimiter.run(() => this.client.executeCommand(args, format));

          // Log the raw command output to help with debugging
          console.error(`Command result: ${result.substring(0, 500)}${result.length > 500 ? '...' : ''}`);
          console.error(`Output file location: ${outputFile}`);

          // The CLI forces a .yml extension on its YAML output, so the file it
          // actually wrote may differ from the requested path; report the real
          // one (NV-4473).
          const actualOutputFile = resolveActualOutputFile(outputFile, fs.existsSync);

          // Report the real artifact, or say so plainly when the CLI wrote no
          // spec file, rather than naming a path that is not there (NV-4473).
          const outputInfo = actualOutputFile
            ? `\nOpenAPI Specification File: ${actualOutputFile}`
            : `\nNo OpenAPI specification file was produced.`;

          // Make sure we're returning the full CLI output followed by our output file information
          console.error(`Returning the command output with file path information appended`);
          return result + outputInfo;
        } catch (cliError: any) {
          // Enrich error message with more context about the command
          const errorMessage = cliError.message;

          if (errorMessage.includes("0 paths discovered")) {
            // Provide lightweight error message
            throw new Error(`No API endpoints found in [${sourcePaths.join(', ')}] using ${languages[0]}. Try more specific directories.`);
          }

          // Check for file system errors and handle them explicitly
          if (errorMessage.includes("read-only file system") ||
              errorMessage.includes("permission denied") ||
              errorMessage.includes("no such file or directory")) {

            throw new Error(`File system error: Unable to write to ${outputFile}.

This may be due to permissions issues. Try specifying a different output location where you have write permissions.`);
          }

          // Check for buffer exceeded errors
          if (errorMessage.includes("maxBuffer length exceeded")) {
            throw new Error(`Output too large. Try analyzing smaller directories or using the 'exclude' parameter to filter files.`);
          }

          throw cliError;
        }
      }
    } catch (error: any) {
      console.error(`Error discovering API endpoints: ${error.message}`);
      throw new Error(`Failed to discover API endpoints: ${error.message}`);
    }
  }
}
