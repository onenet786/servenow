/// <reference types="vite/client" />

interface Window {
  servenowDesktop?: {
    platform: NodeJS.Platform;
    isDesktop: boolean;
  };
}
