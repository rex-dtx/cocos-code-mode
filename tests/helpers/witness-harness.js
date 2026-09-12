'use strict';

const assert = require('node:assert/strict');
const { getJson, getExpectedErrorJson, healthCheck } = require('./utcp-client');

/**
 * Run a live witness without making a qualification decision. The returned
 * record is deliberately evidence-shaped and always carries the build
 * identity and limitations for callers that persist it.
 */
async function liveWitness(testId, run, limitations = []) {
  const health = await healthCheck();
  if (!health.ok) return { skipped: true, testId, reason: health.reason, limitations };
  const build = await getJson('/build-info');
  assert.equal(build.status, 200, JSON.stringify(build.body));
  const result = await run({ getJson, getExpectedErrorJson, health });
  return {
    skipped: false,
    testId,
    build: build.body,
    result,
    limitations: [...limitations, 'Witness evidence does not promote or qualify a portfolio candidate.'],
  };
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
