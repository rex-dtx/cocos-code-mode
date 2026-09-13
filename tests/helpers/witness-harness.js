'use strict';

const assert = require('node:assert/strict');
const { getJson, getExpectedErrorJson, healthCheck } = require('./utcp-client');

/**
 * Run a live witness without making a qualification decision. The returned
 * record is deliberately evidence-shaped and always carries the build
 * identity and limitations for callers that persist it.
 */
async function liveWitness(testId, run, limitations = []) {
  const emit = async (level, message, data = {}) => {
    try {
      await getJson('/tools/editorLog', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ level, message, data }),
      });
    } catch {
      // Editor logging is observability-only; never mask witness results.
    }
    console.log(`[live-test] ${message}`);
  };
  await emit('info', `START ${testId}`, { phase: 'health-check' });
  const health = await healthCheck();
  if (!health.ok) {
    await emit('warn', `SKIP ${testId}: ${health.reason}`, { phase: 'health-check' });
    return { skipped: true, testId, reason: health.reason, limitations };
  }
  const build = await getJson('/build-info');
  assert.equal(build.status, 200, JSON.stringify(build.body));
  await emit('info', `RUN ${testId}`, { phase: 'witness', build: build.body?.build ?? null });
  try {
    const result = await run({ getJson, getExpectedErrorJson, health });
    await emit('info', `PASS ${testId}`, { phase: 'witness' });
    return {
      skipped: false,
      testId,
      build: build.body,
      result,
      limitations: [...limitations, 'Witness evidence does not promote or qualify a portfolio candidate.'],
    };
  } catch (error) {
    await emit('error', `FAIL ${testId}`, { phase: 'witness', error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

function assertPositive(response, message = 'positive witness') {
  assert.equal(response.status, 200, `${message}: ${JSON.stringify(response.body)}`);
  return response.body;
}

async function assertNegative(getError, expectedTestId, expectedStatus = 400) {
  const response = await getError(expectedTestId);
  assert.equal(response.status, expectedStatus, JSON.stringify(response.body));
  return response.body;
}

module.exports = { liveWitness, assertPositive, assertNegative };
