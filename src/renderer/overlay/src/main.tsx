import { initCaptureAgent } from './capture-agent'

// Cached-source scan capture lives outside React — main drives it over IPC
initCaptureAgent()

// Background mode (?background=1) hosts only the WGC capture agent; skip
// loading and mounting React, @zubridge store hooks, i18n, and overlay CSS.
const isBackgroundCaptureOnly =
  new URLSearchParams(window.location.search).get('background') === '1'

if (!isBackgroundCaptureOnly) {
  void import('./mount-ui').then(({ mountOverlayUi }) => {
    mountOverlayUi()
  })
}
