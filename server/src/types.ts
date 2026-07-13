export type ProviderMode = 'builtin' | 'override';

export type AzureProviderProfile = {
  provider: 'azure-openai';
  baseUrl: string;
  apiKey: string;
  apiVersion: string;
  whisperDeployment: string;
  llmDeployment: string;
};

export type ChatMessage = {
  role: string;
  content: string;
};

export type ChatRequest = {
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
};

export type AppBindings = Env & {
  DESKTOP_HMAC_SECRET: string;
  PROVIDER_ENCRYPTION_KEY: string;
  AZURE_OPENAI_ENDPOINT: string;
  AZURE_OPENAI_API_KEY: string;
};

export type AppVariables = {
  installationId: string;
  bodyBytes: ArrayBuffer;
};
