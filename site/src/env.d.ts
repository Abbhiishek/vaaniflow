/// <reference types="astro/client" />

declare module '@fontsource-variable/manrope';
declare module '@fontsource-variable/newsreader';

interface ImportMetaEnv {
  readonly GITHUB_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
