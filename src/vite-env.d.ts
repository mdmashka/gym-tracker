interface ImportMetaEnv {
  readonly VITE_MOBILE_LINK_URL?: string;
  readonly VITE_API_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
