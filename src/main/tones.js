// Picks the writing register for the polish stage from where the dictation
// will land. Priority: user-defined per-app profiles (Style page) → automatic
// detection from the foreground app/window title → the default tone.
// Pure module (no Electron imports) so it stays unit-testable.
'use strict';

// Built-in categories, first match wins. `apps` match the process name,
// `titles` match the window title (covers web apps living in a browser tab).
const AUTO_TONE_RULES = [
  {
    tone: 'chat',
    apps: ['slack', 'discord', 'teams', 'ms-teams', 'whatsapp', 'telegram', 'signal', 'messenger'],
    titles: ['slack', 'discord', 'whatsapp', 'telegram', 'messages']
  },
  {
    tone: 'prompt',
    apps: ['claude', 'chatgpt', 'cursor', 'windsurf', 'perplexity'],
    titles: ['chatgpt', 'claude', 'gemini', 'copilot', 'perplexity', 'deepseek', 'grok', 'ai studio']
  },
  {
    tone: 'email',
    apps: ['outlook', 'olk', 'hxoutlook', 'thunderbird', 'mailbird'],
    titles: ['gmail', 'outlook', 'inbox', 'compose', 'mail']
  },
  {
    tone: 'technical',
    apps: [
      'code', 'devenv', 'idea64', 'pycharm64', 'webstorm64', 'rider64', 'clion64', 'goland64',
      'sublime_text', 'notepad++', 'zed', 'windowsterminal', 'openconsole', 'powershell', 'pwsh',
      'cmd', 'conhost', 'alacritty', 'wezterm-gui'
    ],
    titles: []
  },
  {
    tone: 'formal',
    apps: ['winword', 'powerpnt'],
    titles: ['google docs', 'confluence', 'notion']
  }
];

function pickTone(appInfo, settings) {
  const app = String(appInfo?.app || '').toLowerCase();
  const title = String(appInfo?.title || '').toLowerCase();
  const hay = `${app} ${title}`;

  // user-defined profiles always win
  for (const p of settings.appProfiles || []) {
    const match = String(p?.match || '').toLowerCase().trim();
    if (match && hay.includes(match)) return p.tone || 'neutral';
  }

  if (settings.autoTone !== false && (app || title)) {
    for (const rule of AUTO_TONE_RULES) {
      if (rule.apps.some((a) => app.includes(a)) || rule.titles.some((t) => title.includes(t))) {
        return rule.tone;
      }
    }
  }

  return settings.defaultTone || 'neutral';
}

module.exports = { pickTone, AUTO_TONE_RULES };
