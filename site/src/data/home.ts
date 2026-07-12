export const navigation = [
  { label: 'Product', href: '#product' },
  { label: 'How it works', href: '#workflow' },
  { label: 'Privacy', href: '#privacy' },
  { label: 'Setup', href: '#setup' }
] as const;

export const productFacts = [
  {
    title: 'No VaaniFlow account',
    description: 'Install Vaani and configure it without creating an account or signing in.'
  },
  {
    title: 'Local app data',
    description: 'Settings, history, dictionary entries, snippets, insights, and profile details stay on this device.'
  },
  {
    title: 'Your provider',
    description: 'Speech and optional language-model requests use the Azure OpenAI deployments you configure.'
  },
  {
    title: 'Open source',
    description: 'The project is MIT licensed, developed in public, and available to inspect or contribute to.'
  }
] as const;

export const workflowSteps = [
  {
    number: '01',
    action: 'Hold',
    title: 'Start at the cursor',
    description: 'Hold Ctrl + Win from the Windows text field where you want the words to appear.'
  },
  {
    number: '02',
    action: 'Speak',
    title: 'Say it naturally',
    description: 'Keep working in the same app while Vaani records and transcribes your thought.'
  },
  {
    number: '03',
    action: 'Release',
    title: 'Receive usable text',
    description: 'Release the shortcut. Vaani processes the result and inserts it at your cursor.'
  }
] as const;

export const localData = [
  'Settings and preferences',
  'Dictation history and insights',
  'Local profile details',
  'Dictionary entries',
  'Snippets',
  'Provider credentials'
] as const;

export const providerData = [
  'Recorded audio goes to the configured Whisper deployment.',
  'Transcript text can go to the configured language-model deployment when cleanup or writing styles are enabled.'
] as const;

export const requirements = [
  {
    label: 'Windows',
    value: 'Windows 10 or 11'
  },
  {
    label: 'Speech',
    value: 'An Azure OpenAI resource with a Whisper deployment'
  },
  {
    label: 'Optional polish',
    value: 'A language-model deployment for cleanup and writing styles'
  }
] as const;
