'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.join(__dirname, '..');
const required = [
  ['CCB_MEMBER_CREDENTIAL', 'member EdDSA JWT'],
];

function fail(message) { throw new Error(message); }
function run(command, args) {
  console.log(`\n==> ${command} ${args.join(' ')}`);
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', command)], { cwd: root, stdio: 'inherit', env: process.env });
  if (result.status !== 0) fail(`${command} failed with exit ${result.status}`);
}
function checkConfiguration() {
  const missing = required.filter(([name]) => !process.env[name]).map(([name, label]) => `${name} (${label})`);
  if (missing.length) fail(`missing required protected qualification inputs:\n- ${missing.join('\n- ')}`);
  if (!process.env.CCB_PROJECT_ID) console.warn('CCB_PROJECT_ID not set; enrollment can proceed, protected execution cannot.');
  if (!process.env.CCB_ADMIN_CREDENTIAL) console.warn('CCB_ADMIN_CREDENTIAL not set; admin operations will be skipped.');
  if (process.env.CCB_RELEASE_ORIGIN && !/^https:\/\//.test(process.env.CCB_RELEASE_ORIGIN)) fail('CCB_RELEASE_ORIGIN must use HTTPS when configured');
}
function statusReport() {
  const checks = [
    { gate: "release-origin", variables: ["CCB_RELEASE_ORIGIN"] },
    { gate: "signed-release-inputs", variables: ["CCB_RELEASE_ROOT_METADATA_PATH", "CCB_RELEASE_ZIP", "CCB_RELEASE_ROOT_PATH", "CCB_RELEASE_ROOT_SHA256"] },
    { gate: "member-authentication", variables: ["CCB_MEMBER_CREDENTIAL"] },
    { gate: "project-binding", variables: ["CCB_PROJECT_ID"] },
    { gate: "device-identity", variables: ["CCB_DEVICE_IDENTITY_PATH"], optional: true },
    { gate: "execution-verification", variables: ["CCB_EXECUTION_KEY_ID", "CCB_EXECUTION_PUBLIC_KEY"] },
    { gate: "admin-authentication", variables: ["CCB_ADMIN_CREDENTIAL"] },
    { gate: "scoped-grant", variables: ["CCB_GRANT_DEVICE_ID", "CCB_GRANT_PROJECT_ID", "CCB_GRANT_OPERATION_CLASS"] },
  ].map((check) => {
    const configured = check.variables.every((name) => Boolean(process.env[name]));
    return { gate: check.gate, configured, optional: Boolean(check.optional), variables: check.variables };
  });
  const requiredChecks = checks.filter((check) => !check.optional);
  const next = requiredChecks.find((check) => !check.configured);
  console.log(JSON.stringify({
    readyForAutomation: !next,
    nextBlockedGate: next ? next.gate : null,
    checks,
  }, null, 2));
}

function main() {
  if (process.argv.includes("--status")) {
    statusReport();
    return;
  }
  checkConfiguration();
  run('check-live-prereqs.js', []);
  run('enroll-device.js', []);
  if (process.env.CCB_ADMIN_CREDENTIAL) {
    run('manage-device.js', ['list-devices']);
    if (process.env.CCB_APPROVED_DEVICE_ID) run('manage-device.js', ['approve', process.env.CCB_APPROVED_DEVICE_ID]);
    if (process.env.CCB_GRANT_OPERATION_CLASS && process.env.CCB_GRANT_DEVICE_ID && process.env.CCB_GRANT_PROJECT_ID) {
      run('manage-device.js', ['grant']);
    } else {
      console.warn('Grant skipped; set CCB_GRANT_DEVICE_ID, CCB_GRANT_PROJECT_ID, and CCB_GRANT_OPERATION_CLASS after reviewing pending devices.');
    }
  }
  console.log('\nLocal qualification automation completed through enrollment. Signed updater activation and Creator protected workflow execution remain explicit live-runtime steps.');
}
try { main(); } catch (error) { console.error(`qualify-protected failed: ${error.message}`); process.exitCode = 1; }
