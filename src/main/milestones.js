'use strict';

const WORD_MILESTONES = [100, 500, 1000, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000];

function crossedWordMilestones(previousWords, totalWords, reached = []) {
  const reachedSet = new Set((Array.isArray(reached) ? reached : []).map(Number));
  return WORD_MILESTONES.filter((milestone) => (
    milestone > Number(previousWords || 0)
    && milestone <= Number(totalWords || 0)
    && !reachedSet.has(milestone)
  ));
}

function milestoneMessage(words) {
  return `${Number(words).toLocaleString()} words dictated with Vaani.`;
}

module.exports = { WORD_MILESTONES, crossedWordMilestones, milestoneMessage };
