/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** MapLibre style URL for the moderator map. */
  readonly VITE_MAP_STYLE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
