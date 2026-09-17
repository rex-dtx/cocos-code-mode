#!/usr/bin/env node
'use strict';
const { SessionLifecycleManager } = require('./manager');

/** JSONL adapter for any parent process; stdin EOF owns the complete lifetime. */
async function serve(input, output, options = {}) {
  const send = value => {
    if (output.destroyed || output.writableLength > 65536) {
      input.destroy();
      throw Object.assign(new Error('Output unavailable.'), {code:'OUTPUT_UNAVAILABLE'});
    }
    output.write(JSON.stringify(value) + '\n');
  };
  const manager = new SessionLifecycleManager({...options, emit: event => send({type:'status', ...event})});
  let buffer = '';
  input.setEncoding('utf8');
  try {
    for await (const chunk of input) {
      buffer += chunk;
      let boundary;
      while ((boundary = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 1);
        if (Buffer.byteLength(line) > 8192) throw Object.assign(new Error('Frame too large.'), {code:'FRAME_TOO_LARGE'});
        let id = null;
        try {
          const command = JSON.parse(line);
          if (!command || typeof command !== 'object' || Array.isArray(command)
            || typeof command.id !== 'string' || !/^[a-zA-Z0-9._:-]{1,128}$/.test(command.id)
            || Object.keys(command).some(key => !['id','operation','sessionId','project'].includes(key))) {
            throw Object.assign(new Error('Invalid command.'), {code:'INVALID_COMMAND'});
          }
          id = command.id;
          let presenceId;
          if (command.operation === 'open') presenceId = await manager.open(command);
          else if (command.operation === 'close' && typeof command.sessionId === 'string') await manager.close(command.sessionId);
          else throw Object.assign(new Error('Invalid operation.'), {code:'INVALID_COMMAND'});
          send({type:'response', id, ok:true, ...(presenceId ? {presenceId} : {})});
        } catch (error) {
          send({type:'response', id, ok:false, code:/^[A-Z_]{1,80}$/.test(error.code || '') ? error.code : 'INVALID_COMMAND'});
        }
      }
      if (Buffer.byteLength(buffer) > 8192) throw Object.assign(new Error('Frame too large.'), {code:'FRAME_TOO_LARGE'});
    }
    if (buffer.trim()) throw Object.assign(new Error('Unterminated frame.'), {code:'INCOMPLETE_FRAME'});
  } finally {
    await manager.shutdown();
  }
}
module.exports = { serve };
if (require.main === module) {
  serve(process.stdin, process.stdout, {
    ...(process.env.CCB_SESSION_REGISTRY ? {registryPath:process.env.CCB_SESSION_REGISTRY} : {}),
    label:'Agent host',
  }).catch(error => {
    process.stderr.write((/^[A-Z_]{1,80}$/.test(error.code || '') ? error.code : 'HOST_FAILED') + '\n');
    process.exitCode = 1;
  });
}
