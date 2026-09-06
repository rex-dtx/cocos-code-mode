'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');

const { LocalHttpServer, sendJson } = requireDist('utcp/http-server.js');

describe('finite native localhost HTTP server', () => {
  it('serves authenticated bounded JSON and denies missing local credentials', async () => {
    const auth = { relayInstanceId: '11111111-1111-4111-8111-111111111111', token: 'x'.repeat(43), variableName: 'CCB_LOCAL_TOKEN' };
    const server = new LocalHttpServer(auth);
    server.route('POST', '/echo', ({ body, query, response }) => sendJson(response, 200, { body, query }));
    const port = await server.listen(0);
    try {
      const denied = await fetch(`http://127.0.0.1:${port}/echo`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
      });
      assert.equal(denied.status, 401);
      assert.equal((await denied.json()).code, 'CCB_AUTH_REQUIRED');

      const accepted = await fetch(`http://127.0.0.1:${port}/echo?count=2&enabled=true`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-ccb-local-token': auth.token },
        body: JSON.stringify({ value: 'ok' }),
      });
      assert.equal(accepted.status, 200);
      assert.deepEqual(await accepted.json(), { body: { value: 'ok' }, query: { count: 2, enabled: true } });
    } finally {
      await server.close();
    }
  });
});
