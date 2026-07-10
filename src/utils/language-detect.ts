import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';

export type NightVisionLanguage = 'csharp' | 'go' | 'java' | 'js' | 'php' | 'python' | 'ruby';

export interface LanguageDetection {
  languages: NightVisionLanguage[];
  frameworks: string[];
  package_manager: string | null;
}

function readJson(file: string): any | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function hasFile(root: string, name: string): boolean {
  return existsSync(path.join(root, name));
}

function deps(pkg: any): string[] {
  return [
    ...Object.keys(pkg?.dependencies ?? {}),
    ...Object.keys(pkg?.devDependencies ?? {})
  ].map((dep) => dep.toLowerCase());
}

function sampleFiles(root: string, limit = 500): string[] {
  const out: string[] = [];
  const ignored = new Set(['node_modules', '.git', 'dist', 'build', 'vendor', '.next']);
  const walk = (dir: string) => {
    if (out.length >= limit) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (ignored.has(entry)) continue;
      const full = path.join(dir, entry);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) walk(full);
      else out.push(full);
      if (out.length >= limit) return;
    }
  };
  walk(root);
  return out;
}

export function detectLanguages(projectPath: string): LanguageDetection {
  const root = path.resolve(projectPath);
  const languages = new Set<NightVisionLanguage>();
  const frameworks = new Set<string>();
  let packageManager: string | null = null;

  const packageJson = readJson(path.join(root, 'package.json'));
  if (packageJson) {
    languages.add('js');
    packageManager = hasFile(root, 'pnpm-lock.yaml') ? 'pnpm' : hasFile(root, 'yarn.lock') ? 'yarn' : 'npm';
    const allDeps = deps(packageJson);
    if (allDeps.includes('express')) frameworks.add('express');
    if (allDeps.includes('@nestjs/core')) frameworks.add('nestjs');
    if (allDeps.includes('fastify')) frameworks.add('fastify');
  }

  if (hasFile(root, 'requirements.txt') || hasFile(root, 'pyproject.toml') || hasFile(root, 'setup.py')) {
    languages.add('python');
    if (!packageManager) packageManager = hasFile(root, 'pyproject.toml') ? 'python' : 'pip';
    const combined = ['requirements.txt', 'pyproject.toml']
      .map((name) => {
        try { return readFileSync(path.join(root, name), 'utf8').toLowerCase(); } catch { return ''; }
      })
      .join('\n');
    if (combined.includes('fastapi')) frameworks.add('fastapi');
    if (combined.includes('flask')) frameworks.add('flask');
    if (combined.includes('django')) frameworks.add('django');
  }

  if (hasFile(root, 'pom.xml') || hasFile(root, 'build.gradle') || hasFile(root, 'build.gradle.kts')) {
    languages.add('java');
    if (!packageManager) packageManager = hasFile(root, 'pom.xml') ? 'maven' : 'gradle';
    const combined = ['pom.xml', 'build.gradle', 'build.gradle.kts']
      .map((name) => {
        try { return readFileSync(path.join(root, name), 'utf8').toLowerCase(); } catch { return ''; }
      })
      .join('\n');
    if (combined.includes('spring')) frameworks.add('spring');
    if (combined.includes('jersey')) frameworks.add('jersey');
  }

  if (hasFile(root, 'go.mod')) {
    languages.add('go');
    if (!packageManager) packageManager = 'go';
  }

  if (hasFile(root, 'Gemfile')) {
    languages.add('ruby');
    if (!packageManager) packageManager = 'bundler';
  }

  for (const file of sampleFiles(root)) {
    const ext = path.extname(file).toLowerCase();
    if (ext === '.cs') languages.add('csharp');
    if (ext === '.php') languages.add('php');
    if (ext === '.go') languages.add('go');
    if (ext === '.rb') languages.add('ruby');
    if (ext === '.java') languages.add('java');
    if (ext === '.py') languages.add('python');
  }

  return {
    languages: [...languages],
    frameworks: [...frameworks],
    package_manager: packageManager
  };
}
