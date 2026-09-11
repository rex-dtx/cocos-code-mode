'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_CREDENTIAL_BYTES = 16 * 1024;

function readCredential(valueName, fileName, env = process.env) {
  const inline = env[valueName];
  const file = env[fileName];
  if (inline && file) throw new Error(`Configure only one of ${valueName} or ${fileName}`);
  if (!inline && !file) return undefined;
  let value = inline;
  if (file) {
    if (!path.isAbsolute(file)) throw new Error(`${fileName} must be an absolute path`);
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size < 1 || stat.size > MAX_CREDENTIAL_BYTES) {
      throw new Error(`${fileName} must name a 1..${MAX_CREDENTIAL_BYTES}-byte file`);
    }
    value = fs.readFileSync(file, 'utf8');
  }
  const credential = value.trim();
  if (!credential || credential.length > MAX_CREDENTIAL_BYTES || /\s/.test(credential)) {
    throw new Error(`${valueName} must contain one bounded token without whitespace`);
  }
  return credential;
}

module.exports = { MAX_CREDENTIAL_BYTES, readCredential };
