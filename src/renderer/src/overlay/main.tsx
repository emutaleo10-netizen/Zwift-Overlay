import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@renderer/styles/index.css'
import { OverlayApp } from './OverlayApp'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <OverlayApp />
  </StrictMode>
)
