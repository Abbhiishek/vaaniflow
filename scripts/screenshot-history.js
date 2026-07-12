#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.VAANI_DATA_DIR || path.join(process.env.APPDATA || '', 'Vaani');
const HISTORY_PATH = path.join(DATA_DIR, 'history.json');
const BACKUP_PATH = path.join(DATA_DIR, 'history.pre-social-screenshots.json');
const MOCK_SOURCE = 'social-screenshot';

function readJson(filePath, fallback = []) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2));
  fs.renameSync(tempPath, filePath);
}

function wordsIn(history) {
  return history.reduce((sum, entry) => sum + Number(entry.words || 0), 0);
}

function dateKeyFromOffset(offset) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - offset);
  return date.toDateString();
}

function measuredStreak(history) {
  const days = new Set(history.map((entry) => new Date(entry.ts).toDateString()));
  let streak = 0;
  const cursor = new Date();
  if (!days.has(cursor.toDateString())) cursor.setDate(cursor.getDate() - 1);
  while (days.has(cursor.toDateString())) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function summarize(history) {
  const totalWords = wordsIn(history);
  const totalMs = history.reduce((sum, entry) => sum + Number(entry.durationMs || 0), 0);
  const months = new Set(history.map((entry) => {
    const date = new Date(entry.ts);
    return `${date.getFullYear()}-${date.getMonth()}`;
  }));
  return {
    historyPath: HISTORY_PATH,
    backupPath: BACKUP_PATH,
    totalEntries: history.length,
    realEntries: history.filter((entry) => entry.mockSource !== MOCK_SOURCE).length,
    mockEntries: history.filter((entry) => entry.mockSource === MOCK_SOURCE).length,
    totalWords,
    dayStreak: measuredStreak(history),
    averageWpm: totalMs > 3000 ? Math.round(totalWords / (totalMs / 60000)) : null,
    activeMonths: months.size
  };
}

const apps = [
  'ChatGPT', 'Slack', 'Notion', 'Visual Studio Code', 'Gmail', 'Microsoft Teams',
  'ChatGPT', 'Slack', 'Notion', 'Visual Studio Code', 'WhatsApp', 'Google Chrome',
  'ChatGPT', 'Slack', 'Notion', 'Gmail', 'ChatGPT', 'Slack', 'Visual Studio Code', 'ChatGPT'
];

const commonCopy = 'The project team reviewed the project dashboard and aligned the next product update with customer feedback. The voice workflow captured clear project notes for design, content, launch planning, research, meetings, and follow up. The team confirmed priorities, assigned owners, documented decisions, prepared insights, and scheduled the final product review. Vaani made the workflow faster while keeping every important project detail ready for action.';

const appCopy = {
  ChatGPT: 'We drafted a thoughtful prompt, refined the response, compared options, and turned the conversation into a practical action plan.',
  Slack: 'We shared the update in the team channel, clarified blockers, tagged the owners, and agreed on the next milestone.',
  Notion: 'We organized the roadmap, updated the product brief, captured research notes, and linked every decision to the launch plan.',
  'Visual Studio Code': 'We reviewed the implementation, documented the feature behavior, listed testing steps, and prepared the code changes for review.',
  Gmail: 'We wrote a concise email, summarized the decision, included the relevant context, and requested feedback before the deadline.',
  'Microsoft Teams': 'We summarized the meeting, recorded action items, assigned responsibilities, and confirmed the schedule for the next discussion.',
  WhatsApp: 'We sent a clear message, confirmed the plan, shared a quick update, and kept the conversation friendly and direct.',
  'Google Chrome': 'We researched examples, compared product details, collected useful references, and saved the strongest ideas for the project.'
};

function makeText(wordCount, index, app) {
  const tokens = `${commonCopy} ${appCopy[app]}`.split(/\s+/);
  const output = [];
  const start = (index * 13) % tokens.length;
  for (let position = 0; position < wordCount; position += 1) {
    output.push(tokens[(start + position) % tokens.length]);
  }
  output[0] = output[0].charAt(0).toUpperCase() + output[0].slice(1);
  if (!/[.!?]$/.test(output[output.length - 1])) output[output.length - 1] += '.';
  return output.join(' ');
}

function timestampFor(offset, index) {
  const date = new Date();
  date.setHours(7 + index % 11, index * 17 % 60, index * 7 % 60, 0);
  date.setDate(date.getDate() - offset);
  return date.getTime();
}

function chooseStreak(baseline) {
  const baselineDays = new Set(baseline.map((entry) => new Date(entry.ts).toDateString()));
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = crypto.randomInt(9, 25);
    if (!baselineDays.has(dateKeyFromOffset(candidate))) return candidate;
  }
  return 18;
}

function seed() {
  const current = readJson(HISTORY_PATH);
  if (!fs.existsSync(BACKUP_PATH)) writeJson(BACKUP_PATH, current);

  const baseline = readJson(BACKUP_PATH).filter((entry) => entry.mockSource !== MOCK_SOURCE);
  const targetWords = crypto.randomInt(50300, 50901);
  const streak = chooseStreak(baseline);
  const activeOffsets = [];

  for (let offset = 0; offset < streak; offset += 1) activeOffsets.push(offset);
  for (let offset = streak + 1; offset <= 178; offset += 1) {
    const weekday = new Date(Date.now() - offset * 86400000).getDay();
    const chance = weekday === 0 || weekday === 6 ? 18 : 68;
    if (crypto.randomInt(100) < chance) activeOffsets.push(offset);
  }

  const mockCount = crypto.randomInt(265, 286);
  const neededWords = Math.max(0, targetWords - wordsIn(baseline));
  const entryOffsets = [...activeOffsets];
  const recentOffsets = activeOffsets.filter((offset) => offset > 0 && offset < streak);
  while (entryOffsets.length < mockCount) {
    const recentIndex = (entryOffsets.length - activeOffsets.length) % recentOffsets.length;
    entryOffsets.push(recentOffsets[recentIndex]);
  }
  const weights = Array.from({ length: mockCount }, () => crypto.randomInt(90, 211));
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  const wordCounts = weights.map((value) => Math.floor(neededWords * value / weightTotal));
  let remainder = neededWords - wordCounts.reduce((sum, value) => sum + value, 0);
  for (let index = 0; remainder > 0; index = (index + 1) % wordCounts.length) {
    wordCounts[index] += 1;
    remainder -= 1;
  }

  const mockEntries = wordCounts.map((words, index) => {
    const offset = entryOffsets[index];
    const app = apps[index % apps.length];
    const text = makeText(words, index, app);
    const spokenWpm = crypto.randomInt(126, 166);
    const rawPrefix = index % 3 === 0
      ? 'um um um uh uh basically actually kinda gonna teh recieve definately'
      : index % 3 === 1
        ? 'um uh basically kinda teh recieve'
        : 'um actually gonna definately';

    return {
      id: crypto.randomUUID(),
      text,
      ts: timestampFor(offset, index),
      durationMs: Math.round(words / spokenWpm * 60000),
      words,
      mode: index % 7 === 0 ? 'handsfree' : 'ptt',
      app,
      polished: true,
      latency: {
        uploadMs: crypto.randomInt(220, 680),
        transcriptionMs: crypto.randomInt(520, 1450),
        polishMs: crypto.randomInt(280, 920)
      },
      raw: `${rawPrefix} ${text}`,
      mockSource: MOCK_SOURCE
    };
  });

  const combined = [...baseline, ...mockEntries]
    .sort((left, right) => Number(right.ts || 0) - Number(left.ts || 0));
  writeJson(HISTORY_PATH, combined);
  return summarize(combined);
}

function clear() {
  writeJson(HISTORY_PATH, []);
  return summarize([]);
}

function restore() {
  if (!fs.existsSync(BACKUP_PATH)) throw new Error(`No backup found at ${BACKUP_PATH}`);
  const baseline = readJson(BACKUP_PATH);
  writeJson(HISTORY_PATH, baseline);
  return summarize(baseline);
}

function removeMock() {
  const history = readJson(HISTORY_PATH).filter((entry) => entry.mockSource !== MOCK_SOURCE);
  writeJson(HISTORY_PATH, history);
  return summarize(history);
}

const command = process.argv[2] || 'summary';
const actions = { seed, clear, restore, 'remove-mock': removeMock, summary: () => summarize(readJson(HISTORY_PATH)) };
if (!actions[command]) {
  console.error('Usage: node scripts/screenshot-history.js <seed|summary|remove-mock|restore|clear>');
  process.exit(1);
}

console.log(JSON.stringify(actions[command](), null, 2));
