import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getRepoMetadata } from './repo-metadata.js';

test('getRepoMetadata falls back to directory name outside git repos', () => {
  const baseDir = mkdtempSync(path.join(os.tmpdir(), 'nv-repo-meta-'));
  const projectPath = path.join(baseDir, 'local-service');
  mkdirSync(projectPath);

  const metadata = getRepoMetadata(projectPath);

  assert.equal(metadata.path, projectPath);
  assert.equal(metadata.repo_name, 'local-service');
  assert.equal(metadata.remote_url, null);
  assert.equal(metadata.branch, null);
  assert.equal(metadata.commit_sha, null);
});

test('getRepoMetadata reads git remote, branch, and commit when available', {
  skip: process.platform === 'win32' ? 'uses POSIX git defaults' : false
}, () => {
  const baseDir = mkdtempSync(path.join(os.tmpdir(), 'nv-repo-meta-git-'));
  execFileSync('git', ['init', '-b', 'main', baseDir], { stdio: 'ignore' });
  execFileSync('git', ['-C', baseDir, 'config', 'user.email', 'test@example.com'], { stdio: 'ignore' });
  execFileSync('git', ['-C', baseDir, 'config', 'user.name', 'NightVision Test'], { stdio: 'ignore' });
  execFileSync('git', ['-C', baseDir, 'remote', 'add', 'origin', 'https://github.com/example/demo-api.git'], { stdio: 'ignore' });
  writeFileSync(path.join(baseDir, 'README.md'), '# Demo\n');
  execFileSync('git', ['-C', baseDir, 'add', 'README.md'], { stdio: 'ignore' });
  execFileSync('git', ['-C', baseDir, 'commit', '-m', 'initial'], { stdio: 'ignore' });

  const metadata = getRepoMetadata(baseDir);

  assert.equal(metadata.path, baseDir);
  assert.equal(metadata.repo_name, 'demo-api');
  assert.equal(metadata.remote_url, 'https://github.com/example/demo-api.git');
  assert.equal(metadata.branch, 'main');
  assert.match(metadata.commit_sha ?? '', /^[0-9a-f]{40}$/);
});
