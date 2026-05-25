const fs = require('fs');
const path = require('path');

const BASE_URL = (process.env.EVAL_BASE_URL || 'http://localhost:5500').replace(/\/$/, '');
const CASES_PATH = path.join(process.cwd(), 'evals', 'intent-cases.json');

function loadCases() {
  const raw = fs.readFileSync(CASES_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('evals/intent-cases.json must contain an array');
  }
  return parsed;
}

function validateIntentSchema(intent) {
  if (!intent || typeof intent !== 'object' || Array.isArray(intent)) {
    return { valid: false, issues: ['intent must be an object'] };
  }

  const issues = [];

  if (typeof intent.enabled !== 'boolean') issues.push('enabled must be boolean');
  if (typeof intent.source !== 'string') issues.push('source must be string');
  if (typeof intent.queryRewrite !== 'string') issues.push('queryRewrite must be string');
  if (typeof intent.location !== 'string') issues.push('location must be string');

  const partySize = intent.partySize;
  if (partySize !== null && !(Number.isInteger(Number(partySize)) && Number(partySize) > 0)) {
    issues.push('partySize must be null or positive integer');
  }

  const constraints = intent.constraints;
  if (!constraints || typeof constraints !== 'object' || Array.isArray(constraints)) {
    issues.push('constraints must be object');
  } else {
    ['dogFriendly', 'rv', 'tent', 'waterfront'].forEach(key => {
      if (constraints[key] !== null && typeof constraints[key] !== 'boolean') {
        issues.push(`constraints.${key} must be boolean or null`);
      }
    });

    if (constraints.maxPrice !== null && !(Number.isFinite(Number(constraints.maxPrice)) && Number(constraints.maxPrice) > 0)) {
      issues.push('constraints.maxPrice must be positive number or null');
    }
  }

  if (!Array.isArray(intent.priorities)) {
    issues.push('priorities must be array');
  } else if (intent.priorities.some(item => typeof item !== 'string')) {
    issues.push('priorities entries must be strings');
  }

  if (!Array.isArray(intent.clarificationQuestions)) {
    issues.push('clarificationQuestions must be array');
  } else if (intent.clarificationQuestions.some(item => typeof item !== 'string')) {
    issues.push('clarificationQuestions entries must be strings');
  }

  if (!(Number.isFinite(Number(intent.confidence)) && Number(intent.confidence) >= 0 && Number(intent.confidence) <= 1)) {
    issues.push('confidence must be number 0..1');
  }

  return { valid: issues.length === 0, issues };
}

function evaluateExpectations(intent, expect = {}) {
  const failures = [];
  const location = String(intent.location || '').toLowerCase();
  const constraints = intent.constraints && typeof intent.constraints === 'object' ? intent.constraints : {};
  const confidence = Number(intent.confidence || 0);

  if (Array.isArray(expect.locationIncludes) && expect.locationIncludes.length > 0) {
    const ok = expect.locationIncludes.some(token => location.includes(String(token).toLowerCase()));
    if (!ok) {
      failures.push(`location missing expected token (${expect.locationIncludes.join('|')})`);
    }
  }

  if (Array.isArray(expect.constraintsTrue)) {
    expect.constraintsTrue.forEach(key => {
      if (constraints[key] !== true) {
        failures.push(`constraint ${key} expected true`);
      }
    });
  }

  if (expect.requireMaxPrice === true) {
    if (!(Number.isFinite(Number(constraints.maxPrice)) && Number(constraints.maxPrice) > 0)) {
      failures.push('maxPrice expected to be set');
    }
  }

  if (Number.isFinite(Number(expect.partySize))) {
    if (Number(intent.partySize) !== Number(expect.partySize)) {
      failures.push(`partySize expected ${expect.partySize}`);
    }
  }

  if (expect.requireClarificationQuestions === true) {
    if (!Array.isArray(intent.clarificationQuestions) || intent.clarificationQuestions.length === 0) {
      failures.push('clarificationQuestions expected to be non-empty');
    }
  }

  if (Number.isFinite(Number(expect.minConfidence)) && confidence < Number(expect.minConfidence)) {
    failures.push(`confidence below ${expect.minConfidence}`);
  }

  if (Number.isFinite(Number(expect.maxConfidence)) && confidence > Number(expect.maxConfidence)) {
    failures.push(`confidence above ${expect.maxConfidence}`);
  }

  return failures;
}

async function run() {
  const cases = loadCases();
  const results = [];

  for (const testCase of cases) {
    const payload = {
      query: String(testCase.query || ''),
      context: testCase.context && typeof testCase.context === 'object' ? testCase.context : {}
    };

    let response;
    try {
      response = await fetch(`${BASE_URL}/api/intent/parse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (err) {
      results.push({
        id: testCase.id,
        ok: false,
        schemaValid: false,
        errors: [`request failed: ${String(err.message || err)}`]
      });
      continue;
    }

    if (!response.ok) {
      results.push({
        id: testCase.id,
        ok: false,
        schemaValid: false,
        errors: [`HTTP ${response.status}`]
      });
      continue;
    }

    const data = await response.json();
    const intent = data && typeof data === 'object' ? data.intent : null;

    const schema = validateIntentSchema(intent);
    const expectationFailures = schema.valid ? evaluateExpectations(intent, testCase.expect || {}) : [];
    const errors = [...schema.issues, ...expectationFailures];

    results.push({
      id: testCase.id,
      ok: errors.length === 0,
      schemaValid: schema.valid,
      errors,
      source: intent && intent.source ? intent.source : 'unknown',
      confidence: intent && Number.isFinite(Number(intent.confidence)) ? Number(intent.confidence) : null
    });
  }

  const total = results.length;
  const passed = results.filter(row => row.ok).length;
  const schemaPassed = results.filter(row => row.schemaValid === true).length;

  console.log(`Intent eval cases: ${total}`);
  console.log(`Passed: ${passed}/${total} (${Math.round((passed / Math.max(1, total)) * 100)}%)`);
  console.log(`Schema-valid responses: ${schemaPassed}/${total} (${Math.round((schemaPassed / Math.max(1, total)) * 100)}%)`);
  console.log('');

  results.forEach(row => {
    const status = row.ok ? 'PASS' : 'FAIL';
    const confidenceText = Number.isFinite(Number(row.confidence)) ? Number(row.confidence).toFixed(2) : 'n/a';
    console.log(`${status}  ${row.id}  source=${row.source}  confidence=${confidenceText}`);
    if (!row.ok) {
      row.errors.slice(0, 4).forEach(err => {
        console.log(`  - ${err}`);
      });
    }
  });

  if (passed !== total) {
    process.exitCode = 1;
  }
}

run().catch(err => {
  console.error(`eval failed: ${String(err && err.message ? err.message : err)}`);
  process.exitCode = 1;
});
