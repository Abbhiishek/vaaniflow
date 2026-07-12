'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { crossedWordMilestones, milestoneMessage } = require('../src/main/milestones');

test('milestones trigger only when a dictation crosses an unreached threshold', () => {
  assert.deepEqual(crossedWordMilestones(90, 110, []), [100]);
  assert.deepEqual(crossedWordMilestones(90, 110, [100]), []);
  assert.deepEqual(crossedWordMilestones(490, 1010, []), [500, 1000]);
  assert.equal(milestoneMessage(1000), '1,000 words dictated with Vaani.');
});
