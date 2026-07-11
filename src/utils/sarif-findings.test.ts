import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractSourceFindings, countSourceLinked } from './sarif-findings.js';

const SARIF = {
  runs: [
    {
      tool: { driver: { rules: [
        { id: '119', name: 'SQL Injection - PostgreSQL' },
        { id: 'missing-header', shortDescription: { text: 'Missing Security Header' } }
      ] } },
      results: [
        {
          ruleId: '119',
          level: 'error',
          message: { text: 'SQL injection in the users query' },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: 'src/routes/users.js' },
                region: { startLine: 42 }
              }
            }
          ]
        },
        {
          ruleId: 'missing-header',
          level: 'warning',
          message: { text: 'Missing security header' },
          locations: []
        }
      ]
    }
  ]
};

test('extractSourceFindings maps a finding to its source file and line', () => {
  const findings = extractSourceFindings(SARIF);
  assert.equal(findings.length, 2);
  const sqli = findings.find((f) => f.rule === '119');
  assert.equal(sqli?.file, 'src/routes/users.js');
  assert.equal(sqli?.line, 42);
  assert.equal(sqli?.level, 'error');
});

test('extractSourceFindings resolves the human-readable rule name from the catalog', () => {
  const findings = extractSourceFindings(SARIF);
  assert.equal(findings.find((f) => f.rule === '119')?.rule_name, 'SQL Injection - PostgreSQL');
  assert.equal(findings.find((f) => f.rule === 'missing-header')?.rule_name, 'Missing Security Header');
});

test('extractSourceFindings surfaces source-linked findings first', () => {
  const findings = extractSourceFindings(SARIF);
  assert.equal(findings[0].file, 'src/routes/users.js');
  assert.equal(findings[1].file, null);
});

test('countSourceLinked counts only findings with a source location', () => {
  assert.equal(countSourceLinked(extractSourceFindings(SARIF)), 1);
});

test('extractSourceFindings tolerates an empty or malformed SARIF', () => {
  assert.deepEqual(extractSourceFindings({}), []);
  assert.deepEqual(extractSourceFindings(null), []);
  assert.deepEqual(extractSourceFindings({ runs: [{}] }), []);
});
