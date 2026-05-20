/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PRIVY_APP_ID: string;
  readonly VITE_CONVEX_URL: string;
  readonly VITE_MORPH_HOODI_RPC_URL: string;
  readonly VITE_MORPH_HOODI_CHAIN_ID: string;
  readonly VITE_MORPH_HOODI_EXPLORER: string;

}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
