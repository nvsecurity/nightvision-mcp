import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectLanguages } from './language-detect.js';

test('detectLanguages identifies Express JavaScript apps', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nv-lang-js-'));
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    dependencies: {
      express: '^5.0.0'
    }
  }));

  const result = detectLanguages(root);

  assert.deepEqual(result.languages, ['js']);
  assert.deepEqual(result.frameworks, ['express']);
  assert.equal(result.package_manager, 'npm');
});

test('detectLanguages identifies Flask Python apps', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nv-lang-python-'));
  writeFileSync(path.join(root, 'requirements.txt'), 'flask==3.0.0\n');

  const result = detectLanguages(root);

  assert.deepEqual(result.languages, ['python']);
  assert.deepEqual(result.frameworks, ['flask']);
  assert.equal(result.package_manager, 'pip');
});

test('detectLanguages samples nested source files for Java', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nv-lang-java-'));
  const sourceDir = path.join(root, 'src', 'main', 'java');
  mkdirSync(sourceDir, { recursive: true });
  writeFileSync(path.join(sourceDir, 'Controller.java'), 'class Controller {}\n');

  const result = detectLanguages(root);

  assert.deepEqual(result.languages, ['java']);
});

test('detectLanguages does not treat loose helper scripts as a Java repo backend language', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nv-lang-java-helper-js-'));
  const sourceDir = path.join(root, 'src', 'main', 'java');
  const scriptDir = path.join(root, 'hawkscripts', 'authentication');
  mkdirSync(sourceDir, { recursive: true });
  mkdirSync(scriptDir, { recursive: true });
  writeFileSync(path.join(root, 'build.gradle'), "implementation 'org.springframework.boot:spring-boot-starter-web'\n");
  writeFileSync(path.join(sourceDir, 'Controller.java'), 'class Controller {}\n');
  writeFileSync(path.join(scriptDir, 'form-auth.js'), 'console.log("browser auth helper");\n');

  const result = detectLanguages(root);

  assert.deepEqual(result.languages, ['java']);
  assert.deepEqual(result.frameworks, ['spring']);
  assert.equal(result.package_manager, 'gradle');
});

test('detectLanguages identifies the checked-in Express fixture', () => {
  const root = path.resolve('fixtures/demo-apps/express-api');

  const result = detectLanguages(root);

  assert.deepEqual(result.languages, ['js']);
  assert.deepEqual(result.frameworks, ['express']);
  assert.equal(result.package_manager, 'npm');
});
