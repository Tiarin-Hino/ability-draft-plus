/// <reference types="vite/client" />

declare const __EXT_VERSION__: string

interface ImportMetaEnv {
  readonly VITE_EBS_URL?: string
  readonly VITE_CATALOG_MANIFEST_URL?: string
}
