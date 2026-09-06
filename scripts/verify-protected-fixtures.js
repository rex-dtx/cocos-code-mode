#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { createPublicKey } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'protected', 'v1');
const keys = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'test-keys.json'), 'utf8'));
const vectors = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'vectors.json'), 'utf8'));
const canonicalCases = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'canonical-cases.json'), 'utf8'));
const negativeCases = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'negative-cases.json'), 'utf8'));
const protocol = require(path.join(root, 'dist', 'protected', 'protocol.js'));
const schemas = require(path.join(root, 'dist', 'protected', 'schemas.js'));
const canonical = require(path.join(root, 'dist', 'protected', 'canonical-json.js'));
const primitives = require(path.join(root, 'dist', 'protected', 'primitive-contract.js'));
const negativeRunner = require(path.join(root, 'dist', 'protected', 'negative-fixture-runner.js'));

const deviceKey = createPublicKey({ key: Buffer.from(keys.device.publicKeySpki, 'base64url'), format: 'der', type: 'spki' });
const executionKey = createPublicKey({ key: Buffer.from(keys.execution.publicKeySpki, 'base64url'), format: 'der', type: 'spki' });
const request = schemas.ProtectedRequestSchema.parse(protocol.verifyProtectedRequest(vectors.signedRequest, deviceKey));
assert.deepEqual(request, vectors.request);
for (const fixture of Object.values(vectors.decisions)) {
  const decision = schemas.GatewayDecisionSchema.parse(protocol.verifyGatewayDecision(fixture.signed, executionKey));
  assert.deepEqual(decision, fixture.decision);
}
assert.equal(canonical.canonicalizeJson(canonicalCases.rfc8785.input), canonicalCases.rfc8785.canonical);
for (const source of canonicalCases.invalidSources) {
  assert.throws(() => canonical.parseCanonicalJson(Buffer.from(source), 1024));
}
assert.throws(() => protocol.decodeBase64Url(`${vectors.signedRequest.signature}=`, 64, 64));
assert.throws(() => schemas.ProtectedRequestSchema.parse({ ...vectors.request, unexpected: true }));
assert.throws(() => primitives.PrimitiveCommandSchema.parse({ op: 'asset.writeText', commandId: 'write', args: { content: 'source' } }));
const mutation = vectors.decisions.mutation.decision.envelope;
assert.throws(() => primitives.ExecutionEnvelopeSchema.parse({ ...mutation, preconditions: [] }));
const negativeResults = negativeCases.cases.map((fixture) => negativeRunner.runNegativeFixture(fixture, vectors, deviceKey, executionKey));
assert.equal(negativeResults.length, 50);
assert.deepEqual(negativeResults.filter((result) => result.rejectedAt === 'accepted'), []);
assert.equal(negativeResults.every((result) => result.creatorMutationIpc === 0), true);
console.log(JSON.stringify({ ok: true, node: process.version, requestId: request.requestId, decisions: Object.keys(vectors.decisions).length, negativeCases: negativeResults.length }));
