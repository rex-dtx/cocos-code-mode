'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { requireDist } = require('../helpers/require-dist');

const { isMessageNotExposed } = requireDist('utcp/utils/editor-message-error.js');


describe('fail-loud audit (docs §2) regressions', () => {
  it('isMessageNotExposed only matches the registry message-not-found form', () => {
    assert.equal(isMessageNotExposed(new Error('Message does not exist: scene - new-scene')), true);
    assert.equal(isMessageNotExposed(new Error('Message does not exist: scene - new-scene'), 'scene', 'new-scene'), true);
    assert.equal(isMessageNotExposed(new Error('Message does not exist: scene - new-scene'), 'scene', 'open-scene'), false);
    assert.equal(isMessageNotExposed(new Error('Config path "rendering" does not exist')), false);
    assert.equal(isMessageNotExposed(new Error('Asset db://assets/x.png does not exist')), false);
    assert.equal(isMessageNotExposed('Message does not exist: programming - query-sorted-plugins', 'programming', 'query-sorted-plugins'), true);
  });

});
