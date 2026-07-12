// Resolves the Style profile for the app that was focused when dictation began.
// Pure module (no Electron imports) so app classification stays unit-testable.
'use strict';

const CATEGORY_RULES = [
  {
    category: 'email',
    apps: ['outlook', 'olk', 'hxoutlook', 'thunderbird', 'mailbird', 'mailspring'],
    titles: ['gmail', 'outlook', 'proton mail', 'protonmail', 'yahoo mail', 'compose - mail', 'inbox - mail']
  },
  {
    category: 'personal',
    apps: ['whatsapp', 'telegram', 'signal', 'messenger', 'instagram', 'discord'],
    titles: ['whatsapp', 'telegram', 'signal', 'instagram', 'discord', 'facebook messenger', 'messenger']
  },
  {
    category: 'work',
    apps: ['slack', 'teams', 'ms-teams', 'mattermost', 'webex'],
    titles: ['slack', 'microsoft teams', 'linkedin', 'mattermost', 'google chat', 'workplace chat']
  }
];

const STYLE_DEFAULTS = {
  personal: 'casual',
  work: 'casual',
  email: 'formal',
  other: 'formal'
};

const ALLOWED_STYLES = {
  personal: new Set(['formal', 'casual', 'very-casual']),
  work: new Set(['formal', 'casual', 'excited']),
  email: new Set(['formal', 'casual', 'excited']),
  other: new Set(['formal', 'casual', 'excited'])
};

function detectStyleCategory(appInfo) {
  const app = String(appInfo?.app || '').toLowerCase();
  const title = String(appInfo?.title || '').toLowerCase();

  for (const rule of CATEGORY_RULES) {
    if (rule.apps.some((value) => app.includes(value))
      || rule.titles.some((value) => title.includes(value))) {
      return rule.category;
    }
  }
  return 'other';
}

function pickStyle(appInfo, settings = {}) {
  const category = detectStyleCategory(appInfo);
  const configured = settings[`${category}Style`];
  const variant = ALLOWED_STYLES[category].has(configured)
    ? configured
    : STYLE_DEFAULTS[category];
  return { category, variant };
}

// Backward-compatible export for callers outside the session pipeline.
function pickTone(appInfo, settings) {
  return pickStyle(appInfo, settings).variant;
}

module.exports = {
  pickStyle,
  pickTone,
  detectStyleCategory,
  CATEGORY_RULES,
  STYLE_DEFAULTS
};
