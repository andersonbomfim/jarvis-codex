/** Plain narration for every TTS entry point. Never changes the displayed answer. */
export function speechText(value) {
  let inSources = false
  const withoutSources = String(value).split(/\r?\n/).filter(line => {
    if (/^\s*(?:#{1,6}\s*)?(?:\*\*|__)?(?:fontes(?: consultadas)?|referências(?: bibliográficas)?|sources|references)(?:\*\*|__)?\s*[:：]/iu.test(line)) {
      inSources = true
      return false
    }
    if (inSources) {
      if (!line.trim()) { inSources = false; return false }
      if (/https?:\/\/|www\.|^\s*(?:[-*•]|\d+[.)])\s/u.test(line)) return false
      inSources = false
    }
    return true
  }).join('\n')
  return withoutSources
    .replace(/:codex-[\w-]+\{[^}]*\}/g, '')
    .replace(/[^]*/g, '')
    .replace(/```[\s\S]*?```/g, ' Os detalhes técnicos estão no texto. ')
    .replace(/!?\[([^\]\n]*)\]\((?:[^\s()]|\([^()\s]*\))+\)/g, '$1')
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, '$1')
    .replace(/<https?:\/\/[^>]+>/gi, '')
    .replace(/\bem\s+((?:https?:\/\/|www\.)[^\s<>"`]+)/giu, (_, url) => 'no texto' + (/[.,;:!?]+$/.exec(url)?.[0] || ''))
    .replace(/\b(?:https?:\/\/|www\.)[^\s<>"`]+/giu, url => 'o endereço indicado no texto' + (/[.,;:!?]+$/.exec(url)?.[0] || ''))
    .replace(/\[\^\w+\]/g, '')
    .replace(/[A-Z]:\\[^\n"<>]+/gi, '')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/^\s*(?:#{1,6}\s+|[-*•>]\s+|\d+[.)]\s+)/gm, '')
    .replace(/\*\*|__|`|~~/g, '')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/\(\s*\)|\[\s*\]/g, '')
    .replace(/[ \t]+([,.;:!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}
