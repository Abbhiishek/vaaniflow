// These are deployment names, not model names. Change them to match the
// deployments created inside the self-hoster's Azure OpenAI resource.
export const BUILTIN_AZURE_DEPLOYMENTS = {
  apiVersion: '2024-10-21',
  whisper: 'gpt-4o-transcribe',
  chat: 'gpt-4o'
} as const;
