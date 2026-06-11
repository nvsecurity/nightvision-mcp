import { test } from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import { NightVisionService } from './nightvision.js';

// Capture the query string the service would actually send by swapping in an
// axios adapter that short-circuits the request. node:test runs each test file
// in its own process, so this global mutation does not leak to other files; we
// also restore it in a finally.
function captureQuery(): { adapter: any; get: () => string } {
  let captured = '(no request)';
  const adapter = async (config: any) => {
    const serialize = config.paramsSerializer && config.paramsSerializer.serialize;
    captured = serialize ? serialize(config.params) : `BRACKETED:${JSON.stringify(config.params)}`;
    return { data: { count: 0, results: [] }, status: 200, statusText: 'OK', headers: {}, config };
  };
  return { adapter, get: () => captured };
}

test('get-scan-checks sends severity and status as repeated keys', async () => {
  const original = axios.defaults.adapter;
  const cap = captureQuery();
  axios.defaults.adapter = cap.adapter;
  try {
    const svc = new NightVisionService();
    await svc.getScanChecks('scan-1', { severity: ['critical', 'high'], status: [0, 1], page_size: 5 }, 'json');
  } finally {
    axios.defaults.adapter = original;
  }
  const q = cap.get();
  // The API's severity choices are uppercase; the tool's lowercase enum values
  // must be normalized or the request is rejected with a 400.
  assert.match(q, /(^|&)severity=CRITICAL(&|$)/, q);
  assert.match(q, /(^|&)severity=HIGH(&|$)/, q);
  assert.ok(!/severity=(critical|high)(&|$)/.test(q), `severity must be uppercased: ${q}`);
  assert.match(q, /(^|&)status=0(&|$)/, q);
  assert.match(q, /(^|&)status=1(&|$)/, q);
  assert.ok(!/severity(\[|%5B)/.test(q), `severity must not be bracketed: ${q}`);
});

test('list-nuclei-templates sends severity as repeated keys', async () => {
  const original = axios.defaults.adapter;
  const cap = captureQuery();
  axios.defaults.adapter = cap.adapter;
  try {
    const svc = new NightVisionService();
    await svc.listNucleiTemplates({ severity: ['critical', 'high'] }, 'json');
  } finally {
    axios.defaults.adapter = original;
  }
  const q = cap.get();
  // The API's severity choices are uppercase (see get-scan-checks above).
  assert.match(q, /(^|&)severity=CRITICAL(&|$)/, q);
  assert.match(q, /(^|&)severity=HIGH(&|$)/, q);
  assert.ok(!/severity=(critical|high)(&|$)/.test(q), `severity must be uppercased: ${q}`);
  assert.ok(!/severity(\[|%5B)/.test(q), `severity must not be bracketed: ${q}`);
});
