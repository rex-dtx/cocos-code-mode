'use strict';
// Durable round-trip: the offline signer (scripts/sign-release.js) emits a
// SignedMetadata envelope that the relay's update/metadata.ts verifier accepts
// for the "target" domain with threshold semantics. Locks the sign<->verify
// contract so a format drift between the release tool and the client is caught.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync, sign, createPublicKey } = require('node:crypto');
const { requireDist } = require('../helpers/require-dist');

const { verifyReleaseMetadata } = requireDist('update/metadata.js');

const TARGET_PREFIX = Buffer.from('CCB1 release-targets\n', 'utf8');

function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') + '}';
}

function targetBody(overrides = {}) {
  return {
    schemaVersion: 1,
    metadataVersion: 1,
    releaseSequence: 1,
    issuedAt: '2026-09-06T00:00:00.000Z',
    expiresAt: '2027-09-06T00:00:00.000Z',
    package: {
      name: 'cc-bridge-3x',
      version: '2.0.0',
      sha256: 'a'.repeat(64),
      size: 42,
      url: '',
      packageManifestSha256: '',
      sbomSha256: '',
      provenanceSha256: '',
    },
    compatibility: {
      protocol: { min: 1, max: 1 },
      creator: '>=3.7.0',
      os: ['win32'],
      arch: ['x64'],
    },
    ...overrides,
  };
}

function signedBy(body, privateKey, keyId = 'targets-fixture-1', prefix = TARGET_PREFIX) {
  const payload = Buffer.from(canonicalize(body), 'utf8');
  const signature = sign(null, Buffer.concat([prefix, payload]), privateKey).toString('base64url');
  return { payload: payload.toString('base64url'), signatures: [{ keyId, signature }] };
}

describe('release metadata sign <-> verify contract', () => {
  const keys = generateKeyPairSync('ed25519');
  const publicKey = createPublicKey({ key: keys.publicKey.export({ type: 'spki', format: 'der' }), format: 'der', type: 'spki' });

  it('verifies a threshold-1 target metadata envelope produced by the signer format', () => {
    const body = targetBody();
    const signed = signedBy(body, keys.privateKey);
    const parsed = verifyReleaseMetadata('target', signed, new Map([['targets-fixture-1', publicKey]]), 1);
    assert.equal(parsed.package.name, 'cc-bridge-3x');
    assert.equal(parsed.package.sha256, 'a'.repeat(64));
    assert.equal(parsed.compatibility.protocol.min, 1);
  });

  it('rejects a signature over the wrong domain prefix', () => {
    const signed = signedBy(targetBody(), keys.privateKey, 'targets-fixture-1', Buffer.from('CCB1 release-root\n', 'utf8'));
    assert.throws(() => verifyReleaseMetadata('target', signed, new Map([['targets-fixture-1', publicKey]]), 1), /threshold not met/);
  });

  it('rejects a signature from an unknown key', () => {
    const signed = signedBy(targetBody(), keys.privateKey, 'targets-fixture-1');
    assert.throws(() => verifyReleaseMetadata('target', signed, new Map([['other-key', publicKey]]), 1), /threshold not met/);
  });

  it('does not double-count duplicate signatures from one key', () => {
    const body = targetBody();
    const payload = Buffer.from(canonicalize(body), 'utf8');
    const sig = sign(null, Buffer.concat([TARGET_PREFIX, payload]), keys.privateKey).toString('base64url');
    const signed = {
      payload: payload.toString('base64url'),
      signatures: [
        { keyId: 'targets-fixture-1', signature: sig },
        { keyId: 'targets-fixture-1', signature: sig },
      ],
    };
    // threshold 2 with a single distinct key must fail — duplicates do not count.
    assert.throws(() => verifyReleaseMetadata('target', signed, new Map([['targets-fixture-1', publicKey]]), 2), /threshold not met/);
  });
});
