const MAX_SEARCH_KEYWORD_LENGTH = 100

export function literalSearchRegex(keyword: string): RegExp {
  const value = String(keyword).slice(0, MAX_SEARCH_KEYWORD_LENGTH)
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  return new RegExp(escaped, 'i')
}
