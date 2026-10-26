export const TRANSLATION_LANGUAGE_NAMES = {
  de: 'German',
  en: 'English',
  fr: 'French',
  it: 'Italian',
  ja: 'Japanese',
  pl: 'Polish',
  'pt-br': 'Brazilian Portuguese',
  tr: 'Turkish',
  'zh-cn': 'Simplified Chinese',
  'zh-tw': 'Traditional Chinese'
} as const

export const SUPPORTED_TRANSLATION_LANGUAGES = Object.keys(TRANSLATION_LANGUAGE_NAMES)

export function normalizeTranslationLanguages(languages: unknown): string[] {
  if (!Array.isArray(languages)) {
    return []
  }

  const supported = new Set(SUPPORTED_TRANSLATION_LANGUAGES)

  return Array.from(
    new Set(
      languages
        .filter((language): language is string => typeof language === 'string')
        .map(language => language.trim().toLowerCase())
        .filter(language => supported.has(language))
    )
  )
}
