import { execFileSync } from 'child_process';
import path from 'path';

function git(projectPath: string, args: string[]): string | null {
  try {
    return execFileSync('git', ['-C', projectPath, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim() || null;
  } catch {
    return null;
  }
}

export interface RepoMetadata {
  path: string;
  repo_name: string;
  remote_url: string | null;
  branch: string | null;
  commit_sha: string | null;
}

export function getRepoMetadata(projectPath: string): RepoMetadata {
  const resolvedPath = path.resolve(projectPath);
  const remoteUrl = git(resolvedPath, ['config', '--get', 'remote.origin.url']);
  const branch = git(resolvedPath, ['branch', '--show-current']);
  const commitSha = git(resolvedPath, ['rev-parse', 'HEAD']);
  const repoName = remoteUrl
    ? path.basename(remoteUrl.replace(/\.git$/i, ''))
    : path.basename(resolvedPath);

  return {
    path: resolvedPath,
    repo_name: repoName,
    remote_url: remoteUrl,
    branch,
    commit_sha: commitSha
  };
}

