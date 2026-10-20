import type { Turn } from '../store'

export type Chat = { id: string; title: string; updated: number; turns: Turn[] }
const key = 'jarvis.conversations.v2'
const activeKey = 'jarvis.active.v2'
export function chats(): Chat[] {
  try { return JSON.parse(localStorage.getItem(key) || '[]') as Chat[] } catch { return [] }
}
export function currentId(): string {
  let id = localStorage.getItem(activeKey)
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(activeKey, id) }
  return id
}
const pageConversationId = currentId()
export function restoredTurns(): Turn[] { return chats().find(c => c.id === pageConversationId)?.turns ?? [] }
export function saveConversation(turns: Turn[]) {
  if (!turns.length) return
  const id = pageConversationId, title = turns.find(t => t.role === 'user')?.text.split('\n')[0].slice(0, 64) || 'Conversa'
  const entry = { id, title, turns: turns.slice(-40), updated: Date.now() }
  try { localStorage.setItem(key, JSON.stringify([entry, ...chats().filter(c => c.id !== id)].slice(0, 30))) } catch { /* Storage full: the live conversation remains available. */ }
}
export function openConversation(id?: string) { localStorage.setItem(activeKey, id ?? crypto.randomUUID()); location.reload() }
// The user requested spoken replies for typed requests as well. Reset a stale
// mute once when installing this change; later explicit mute choices persist.
if (localStorage.getItem('jarvis.spokenReplies.v2') !== 'installed') {
  localStorage.setItem('jarvis.audio', 'on')
  localStorage.setItem('jarvis.spokenReplies.v2', 'installed')
}
export const TEXT_ONLY = new URLSearchParams(location.search).has('text')
export const audioEnabled = () => !TEXT_ONLY && localStorage.getItem('jarvis.audio') !== 'off'
export const selectedEffort = () => localStorage.getItem('jarvis.effort') || 'high'
