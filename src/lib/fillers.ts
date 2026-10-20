import { phrase } from './assistant-cache'

/** Respostas fixas da biblioteca, sem sorteio de frases não gravadas. */
export const working = () => phrase('working')
export const acknowledge = () => phrase('acknowledge')
export const attention = () => phrase('attention')

export function forTool(toolName: string): string {
  const name = toolName.toLowerCase()
  if (/gmail|email|inbox/.test(name)) return phrase('email')
  if (/calendar|agenda/.test(name)) return phrase('calendar')
  if (/weather|previsao/.test(name)) return phrase('weather')
  if (/websearch|web_search|research|serper|tavily|brave|perplexity|exa/.test(name)) return phrase('research')
  if (/search_files|find_file|list_files/.test(name)) return phrase('files')
  if (/open_app|launch_app|navigate|browser_open/.test(name)) return phrase('opening')
  return working()
}