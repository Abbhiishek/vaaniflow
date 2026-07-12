// Local snippet persistence and deterministic expansion helpers.
'use strict';
const crypto = require('crypto');

const SNIPPET_SCHEMA_VERSION = 1;
const TRIGGER_MAX_LENGTH = 100;
const EXPANSION_MAX_LENGTH = 12000;

const DEFAULT_SNIPPETS = [
  {
    id: 'starter-follow-up-email',
    trigger: 'follow up email',
    text: 'Hi,\n\nJust following up on this. Please let me know if you have any questions.\n\nBest,',
    starter: true,
    createdAt: 1
  },
  {
    id: 'starter-rewrite-prompt',
    trigger: 'rewrite prompt',
    text: 'Rewrite this to be clearer, more concise, and easier to act on while preserving the original meaning.',
    starter: true,
    createdAt: 2
  },
  {
    id: 'starter-organize-thoughts',
    trigger: 'organize thoughts',
    text: 'Organize these thoughts into a clear, polished structure with concise headings and actionable next steps.',
    starter: true,
    createdAt: 3
  }
];

function createSnippetId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `snippet-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeTrigger(value) {
  return String(value || '')
    .replace(/^[\s“”"']+|[\s“”"']+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, TRIGGER_MAX_LENGTH);
}

function triggerKey(value) {
  return normalizeTrigger(value).toLocaleLowerCase();
}

function normalizeSnippet(entry, now = Date.now()) {
  if (!entry || typeof entry !== 'object') return null;
  const trigger = normalizeTrigger(entry.trigger);
  const text = String(entry.text ?? '').trim().slice(0, EXPANSION_MAX_LENGTH);
  if (!trigger || !text) return null;
  const id = String(entry.id || '').trim() || createSnippetId();
  const createdAt = Number(entry.createdAt) > 0 ? Number(entry.createdAt) : now;
  const updatedAt = Number(entry.updatedAt) > 0 ? Number(entry.updatedAt) : createdAt;
  return {
    id,
    trigger,
    text,
    starter: !!entry.starter,
    createdAt,
    updatedAt
  };
}

function normalizeSnippets(entries) {
  const result = [];
  const seenTriggers = new Set();
  const seenIds = new Set();
  const now = Date.now();
  for (const [index, entry] of (Array.isArray(entries) ? entries : []).entries()) {
    const normalized = normalizeSnippet(entry, now + index);
    if (!normalized) continue;
    const key = triggerKey(normalized.trigger);
    if (seenTriggers.has(key)) continue;
    seenTriggers.add(key);
    while (!normalized.id || seenIds.has(normalized.id)) normalized.id = createSnippetId();
    seenIds.add(normalized.id);
    result.push(normalized);
  }
  return result;
}

function snippetSettingsPatch(entries) {
  return {
    snippetSchemaVersion: SNIPPET_SCHEMA_VERSION,
    snippets: normalizeSnippets(entries)
  };
}

function migrateSnippets(settings = {}) {
  const current = normalizeSnippets(settings.snippets);
  const version = Number(settings.snippetSchemaVersion) || 0;
  const snippets = version < SNIPPET_SCHEMA_VERSION
    ? normalizeSnippets([...current, ...DEFAULT_SNIPPETS])
    : current;
  const changed = version !== SNIPPET_SCHEMA_VERSION
    || JSON.stringify(current) !== JSON.stringify(Array.isArray(settings.snippets) ? settings.snippets : []);
  return {
    changed,
    patch: changed ? { snippetSchemaVersion: SNIPPET_SCHEMA_VERSION, snippets } : {}
  };
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function spokenPattern(value) {
  return normalizeTrigger(value).split(/\s+/).map((word) => {
    const camelParts = word.replace(/([\p{Ll}\p{N}])([\p{Lu}])/gu, '$1 $2').split(/\s+/);
    return camelParts.map(escapeRegex).join('[\\s-]*');
  }).join('\\s+');
}

function normalizeUtterance(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[“”"']+|[“”"']+$/g, '')
    .replace(/[.!?,;:]+$/g, '')
    .trim()
    .toLocaleLowerCase();
}

function exactTrigger(value) {
  return normalizeUtterance(value).replace(
    /^(?:(?:insert|paste|type|drop|expand|use|add)\s+(?:the\s+)?(?:snippet\s+)?)/u,
    ''
  );
}

// Standalone triggers expand immediately. Inside a longer dictation, matching
// phrases become protected tokens so the polish model can edit the surrounding
// sentence without ever rewriting a URL, signature, prompt, or other expansion.
function expandSnippets(text, snippets) {
  const source = String(text || '');
  const ordered = normalizeSnippets(snippets)
    .sort((a, b) => b.trigger.length - a.trigger.length);
  if (!source.trim() || !ordered.length) {
    return { matched: false, standalone: false, text: source, matches: [] };
  }

  const exact = exactTrigger(source);
  const standalone = ordered.find((snippet) => {
    try { return new RegExp(`^${spokenPattern(snippet.trigger)}$`, 'iu').test(exact); } catch { return false; }
  });
  if (standalone) {
    return {
      matched: true,
      standalone: true,
      text: standalone.text,
      matches: [{ token: null, id: standalone.id, trigger: standalone.trigger, text: standalone.text }]
    };
  }

  const matches = [];
  let protectedText = source;
  for (const snippet of ordered) {
    const pattern = spokenPattern(snippet.trigger);
    if (!pattern) continue;
    const regex = new RegExp(
      `(^|[^\\p{L}\\p{N}_])(?:(?:insert|paste|type|drop|expand)\\s+(?:the\\s+)?(?:snippet\\s+)?)?${pattern}(?=$|[^\\p{L}\\p{N}_])`,
      'giu'
    );
    protectedText = protectedText.replace(regex, (match, prefix) => {
      const token = `[[VAANI_SNIPPET_${matches.length}]]`;
      matches.push({ token, id: snippet.id, trigger: snippet.trigger, text: snippet.text });
      return `${prefix}${token}`;
    });
  }

  return {
    matched: matches.length > 0,
    standalone: false,
    text: protectedText,
    matches
  };
}

function snippetTokensPreserved(text, matches) {
  return (matches || []).every((match) => !match.token || String(text || '').includes(match.token));
}

function restoreSnippets(text, matches) {
  let output = String(text || '');
  let complete = true;
  for (const match of matches || []) {
    if (!match.token) continue;
    if (!output.includes(match.token)) complete = false;
    const token = escapeRegex(match.token);
    output = output.replace(new RegExp(`${token}([.!?,;:]?)`, 'g'), (full, punctuation) => {
      const expansion = String(match.text || '');
      const ending = expansion.trimEnd().slice(-1);
      const duplicateTerminal = /[.!?]/.test(ending) && /[.!?]/.test(punctuation);
      const duplicateSeparator = ending === punctuation && /[,;:]/.test(punctuation);
      return expansion + (duplicateTerminal || duplicateSeparator ? '' : punctuation);
    });
  }
  return { text: output, complete };
}

module.exports = {
  DEFAULT_SNIPPETS,
  SNIPPET_SCHEMA_VERSION,
  TRIGGER_MAX_LENGTH,
  EXPANSION_MAX_LENGTH,
  normalizeTrigger,
  normalizeSnippet,
  normalizeSnippets,
  snippetSettingsPatch,
  migrateSnippets,
  expandSnippets,
  restoreSnippets,
  snippetTokensPreserved
};
