import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

export async function writeManifest(projectPath: string, manifest: Record<string, unknown>): Promise<string> {
  const manifestPath = path.resolve(projectPath, '.nightvision', 'manifest.json');
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return manifestPath;
}

