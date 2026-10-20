type DesktopWindow = Window & { chrome?: { webview?: { postMessage: (message: string) => void } } }

export function hasDesktopWindow(): boolean {
  return typeof window !== 'undefined' && typeof (window as DesktopWindow).chrome?.webview?.postMessage === 'function'
}

export function closeDesktopWindow(): void {
  if (hasDesktopWindow()) (window as DesktopWindow).chrome!.webview!.postMessage('jarvis:close')
}
