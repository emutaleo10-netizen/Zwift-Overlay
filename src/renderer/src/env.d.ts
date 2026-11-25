/// <reference types="vite/client" />
import type { OverlayApi } from '@shared/types/ipc'

declare global {
  interface Window {
    overlayApi: OverlayApi
  }
}

export {}
