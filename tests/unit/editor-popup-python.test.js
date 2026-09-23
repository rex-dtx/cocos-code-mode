'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');

const exec = promisify(execFile);
const probe = path.resolve(__dirname, '../../static/native-popup-probe.py');

async function inspect(pid) {
  const { stdout } = await exec('python', [probe, String(pid)], { timeout: 3000, windowsHide: true });
  return JSON.parse(stdout).windows;
}

it('activates only a fresh exact native button on a disposable dialog', { skip: process.platform !== 'win32' }, async () => {
  const fixture = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "Add-Type -AssemblyName System.Windows.Forms; $owner=New-Object Windows.Forms.Form; $owner.Text='CCP3X Owner'; $owner.Show(); [void][System.Windows.Forms.MessageBox]::Show($owner,'Disposable fixture','CCP3X Fixture',[System.Windows.Forms.MessageBoxButtons]::OKCancel); $owner.Close()"], { stdio: 'ignore', windowsHide: true });
  try {
    let dialog;
    for (let i = 0; i < 30; i++) {
      dialog = (await inspect(fixture.pid)).find(row => row.title === 'CCP3X Fixture' && row.visible);
      if (dialog) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(dialog, 'disposable dialog must become visible');
    const button = dialog.actions.find(item => item.label === 'OK' && item.enabled);
    assert.ok(button, 'disposable OK button must be available');
    const owner = dialog.ownerHwnd || dialog.hwnd;
    const ownerTitle = dialog.ownerHwnd ? (await inspect(fixture.pid)).find(row => row.hwnd === owner)?.title : dialog.title;
    const ownerClass = dialog.ownerHwnd ? (await inspect(fixture.pid)).find(row => row.hwnd === owner)?.className : dialog.className;
    await assert.rejects(exec('python', [probe, String(fixture.pid), dialog.hwnd, button.hwnd, 'wrong title', button.label, owner, ownerTitle, ownerClass], { timeout: 3000, windowsHide: true }));
    assert.ok((await inspect(fixture.pid)).some(row => row.hwnd === dialog.hwnd && row.visible), 'stale refusal must leave dialog open');
    assert.ok(dialog.ownerHwnd, 'fixture must expose an owner for the production action path');
    const { stdout } = await exec('python', [probe, String(fixture.pid), dialog.hwnd, button.hwnd, dialog.title, button.label, owner, ownerTitle, ownerClass], { timeout: 3000, windowsHide: true });
    assert.deepEqual(JSON.parse(stdout), { activated: true, closed: true });
    assert.ok(!(await inspect(fixture.pid)).some(row => row.hwnd === dialog.hwnd && row.visible));
  } finally {
    if (fixture.exitCode === null) fixture.kill();
  }
});
