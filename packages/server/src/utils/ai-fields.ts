/**
 * Structural sanitiser for model-generated form fields.
 *
 * `createFormWithAI` used to store whatever the model returned. Two prompt
 * fixes had already shipped chasing invented keys (#5: which properties each
 * kind requires, #6: the real ValidationInput/PropertyInput schemas), and a
 * third would have followed, because a prompt cannot be a guarantee — the model
 * is free to ignore it. This module is the guarantee, which demotes the prompt
 * to an optimisation: it makes the common case cheap rather than making the
 * output correct.
 *
 * The contract is NOT restated here from the prompt — it is taken from the
 * GraphQL inputs in `common/graphql/form.graphql.ts` (`ValidationInput`,
 * `SharedPropertyInput`, `ChoiceInput`, `ColumnInput`, `PricePropertyInput`) and
 * from `FieldKindEnum`. Those are what the rest of the app accepts, so they are
 * what "valid" means. If a key is added there, add it here; the prompt is the
 * third place to update, not the first.
 *
 * Deliberately REPAIRS rather than rejects. An almost-right form the author can
 * fix in the builder is worth more than an error page, and the failure this
 * replaces was a silent one — a field with a bogus `properties` key reaching the
 * builder and breaking it there. Every repair is recorded so the resolver can
 * log what it had to fix; a rising count is the signal that the prompt has
 * drifted from the schema again.
 *
 * Composes with, and does not replace, `sanitizeFormDrafts` in `form-schema.ts`
 * — that one strips unsafe HTML from titles, which is a separate concern from
 * shape, and the AI path needs both.
 */
import { FieldKindEnum } from '@heyform-inc/shared-types-enums'

import { helper, nanoid } from '@heyform-inc/utils'

/** `ValidationInput` — these four and nothing else. */
const VALIDATION_KEYS = new Set(['required', 'min', 'max', 'matchExpected'])

/** `SharedPropertyInput`, plus `fields` from `PropertyInput` (group children). */
const PROPERTY_KEYS = new Set([
  'showButton',
  'buttonText',
  'hideMarks',
  'allowOther',
  'allowMultiple',
  'badge',
  'verticalAlignment',
  'choices',
  'randomize',
  'choiceStyle',
  'other',
  'numberPreRow',
  'shape',
  'total',
  'start',
  'leftLabel',
  'centerLabel',
  'rightLabel',
  'defaultCountryCode',
  'currency',
  'price',
  'format',
  'allowTime',
  'use12Hours',
  'tableColumns',
  'score',
  'sourceUrl',
  'buttonLinkUrl',
  'redirectUrl',
  'redirectOnCompletion',
  'redirectDelay',
  'fields'
])

/** `ChoiceInput`. */
const CHOICE_KEYS = new Set(['id', 'label', 'image', 'color', 'score', 'isExpected'])
/** `ColumnInput`. */
const COLUMN_KEYS = new Set(['id', 'label', 'type', 'required'])
/** `PricePropertyInput`. */
const PRICE_KEYS = new Set(['type', 'value', 'ref'])

const FIELD_KINDS = new Set<string>(Object.values(FieldKindEnum))

/**
 * Names other form products use for kinds we do have. Without these the
 * `short_text` fallback turns a dropdown into a text box — a silent downgrade
 * that looks like the model's fault. These three are what a model reaches for
 * when it is not following our prompt closely, and they are also 299 of the
 * fields in HeyForm's own template gallery. See unicef/supporthub#363.
 *
 * `dropdown` maps to `multiple_choice` with no `choiceStyle`: the property is in
 * the schema but no value for it is documented anywhere in this repo, and
 * inventing one is the exact bug this module exists to stop. The pick-one
 * semantics survive; only the visual affordance is lost.
 */
const KIND_ALIASES: Record<string, FieldKindEnum> = {
  single_choice: FieldKindEnum.MULTIPLE_CHOICE,
  dropdown: FieldKindEnum.MULTIPLE_CHOICE,
  paragraph: FieldKindEnum.LONG_TEXT
}

/** Aliases whose whole point is "pick exactly one", so `allowMultiple` is forced off. */
const PICK_ONE_ALIASES = new Set(['single_choice', 'dropdown'])

/**
 * Layout blocks, not questions. They have no title and nothing to ask, so they
 * are dropped rather than degraded — a `short_text` with no title would be
 * dropped a moment later anyway, but as "no usable title", which hides what
 * actually happened.
 *
 * `text` is the common one by a wide margin: in the template gallery every real
 * field is followed by one, so a naive import looks like it loses exactly half
 * of every template.
 */
const LAYOUT_KINDS = new Set(['text', 'separator', 'page_break'])

/** Kinds that carry no question and so are allowed an empty title. */
const TITLELESS_KINDS = new Set<string>([
  FieldKindEnum.WELCOME,
  FieldKindEnum.THANK_YOU,
  FieldKindEnum.STATEMENT,
  FieldKindEnum.GROUP
])

const ID_LENGTH = 12
const VALID_ID = /^[A-Za-z0-9_-]{6,32}$/

export interface SanitizeAIFieldsResult {
  readonly fields: any[]
  /** Human-readable list of what had to be corrected. Empty ⇒ the model complied. */
  readonly repairs: string[]
}

/** `default_country_code` → `defaultCountryCode`. Leaves camelCase untouched. */
function toCamelCase(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())
}

/** `shortText` / `ShortText` → `short_text`, to match FieldKindEnum's casing. */
function toSnakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase()
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function freshId(): string {
  return nanoid(ID_LENGTH)
}

/**
 * Keep an id the model supplied if it is usable, otherwise mint one. Keeping it
 * matters: `createFieldsWithAI` edits EXISTING questions, and regenerating an
 * id there would orphan any logic rule pointing at it.
 */
function keepOrMintId(value: unknown, seen: Set<string>): { id: string; minted: boolean } {
  if (typeof value === 'string' && VALID_ID.test(value) && !seen.has(value)) {
    seen.add(value)
    return { id: value, minted: false }
  }
  let id = freshId()
  while (seen.has(id)) id = freshId()
  seen.add(id)
  return { id, minted: true }
}

/**
 * Whitelist an object's keys after camelCasing them, so a `snake_case` key the
 * model invented is recovered rather than silently dropped. Anything still
 * unrecognised is removed and recorded.
 */
function pickAllowed(
  source: Record<string, any>,
  allowed: Set<string>,
  where: string,
  repairs: string[]
): Record<string, any> {
  const out: Record<string, any> = {}
  for (const [rawKey, value] of Object.entries(source)) {
    // An explicitly null key carries the same information as an absent one, so
    // it is dropped WITHOUT a repair line. Not cosmetic: HeyForm's own template
    // gallery ships 1,244 fields whose entire default property set is nulls, and
    // logging those would put ~6,000 lines in front of the handful of repairs
    // that actually mean the schema has drifted.
    if (value === null || value === undefined) continue

    const key = allowed.has(rawKey) ? rawKey : toCamelCase(rawKey)
    if (!allowed.has(key)) {
      repairs.push(`${where}: dropped unknown key "${rawKey}"`)
      continue
    }
    if (key !== rawKey) {
      repairs.push(`${where}: renamed "${rawKey}" to "${key}"`)
    }
    out[key] = value
  }
  return out
}

/**
 * `choices` and `tableColumns` are arrays of objects, but a model that is
 * pattern-matching on "options" reaches for `["Low", "High"]`. Coerce rather
 * than drop — the labels are the part that carries the author's intent.
 */
function toLabelled(
  value: unknown,
  allowed: Set<string>,
  where: string,
  repairs: string[]
): Array<Record<string, any>> | undefined {
  if (!Array.isArray(value)) {
    if (value !== undefined) repairs.push(`${where}: expected an array, dropped`)
    return undefined
  }
  const seen = new Set<string>()
  const out: Array<Record<string, any>> = []
  for (const entry of value) {
    if (typeof entry === 'string' || typeof entry === 'number') {
      repairs.push(`${where}: coerced ${JSON.stringify(entry)} to { id, label }`)
      out.push({ id: keepOrMintId(undefined, seen).id, label: String(entry) })
      continue
    }
    if (!isPlainObject(entry)) {
      repairs.push(`${where}: dropped a non-object entry`)
      continue
    }
    const picked = pickAllowed(entry, allowed, where, repairs)
    const label = typeof picked.label === 'string' ? picked.label.trim() : ''
    if (label === '') {
      repairs.push(`${where}: dropped an entry with no label`)
      continue
    }
    const { id, minted } = keepOrMintId(picked.id, seen)
    if (minted) repairs.push(`${where}: replaced a missing or duplicate id`)
    out.push({ ...picked, id, label })
  }
  return out
}

/** Two generic options, so a choice field the model under-filled stays editable. */
function padLabelled(
  existing: Array<Record<string, any>> | undefined,
  minimum: number,
  noun: string,
  where: string,
  repairs: string[]
): Array<Record<string, any>> {
  const out = [...(existing ?? [])]
  const seen = new Set(out.map(entry => String(entry.id)))
  while (out.length < minimum) {
    repairs.push(`${where}: padded to ${minimum} ${noun}s`)
    out.push({ id: keepOrMintId(undefined, seen).id, label: `${noun} ${out.length + 1}` })
  }
  return out
}

function coerceBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

function coerceNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value)
  }
  return undefined
}

function sanitizeValidations(
  value: unknown,
  where: string,
  repairs: string[]
): Record<string, any> {
  if (!isPlainObject(value)) {
    if (value !== undefined && value !== null) {
      repairs.push(`${where}.validations: expected an object, dropped`)
    }
    return {}
  }
  const picked = pickAllowed(value, VALIDATION_KEYS, `${where}.validations`, repairs)
  const out: Record<string, any> = {}
  for (const key of ['required', 'matchExpected']) {
    if (key in picked) {
      const coerced = coerceBoolean(picked[key])
      if (coerced === undefined) {
        repairs.push(`${where}.validations: dropped non-boolean "${key}"`)
      } else {
        out[key] = coerced
      }
    }
  }
  for (const key of ['min', 'max']) {
    if (key in picked) {
      const coerced = coerceNumber(picked[key])
      if (coerced === undefined) {
        repairs.push(`${where}.validations: dropped non-numeric "${key}"`)
      } else {
        out[key] = coerced
      }
    }
  }
  return out
}

function sanitizeProperties(
  value: unknown,
  kind: string,
  where: string,
  repairs: string[],
  forcePickOne = false
): Record<string, any> {
  const source = isPlainObject(value) ? value : {}
  if (value !== undefined && value !== null && !isPlainObject(value)) {
    repairs.push(`${where}.properties: expected an object, dropped`)
  }
  const out = pickAllowed(source, PROPERTY_KEYS, `${where}.properties`, repairs)

  if ('choices' in out) {
    out.choices = toLabelled(out.choices, CHOICE_KEYS, `${where}.properties.choices`, repairs)
    if (out.choices === undefined) delete out.choices
  }
  if ('tableColumns' in out) {
    out.tableColumns = toLabelled(
      out.tableColumns,
      COLUMN_KEYS,
      `${where}.properties.tableColumns`,
      repairs
    )
    if (out.tableColumns === undefined) delete out.tableColumns
  }
  if ('price' in out) {
    if (isPlainObject(out.price)) {
      out.price = pickAllowed(out.price, PRICE_KEYS, `${where}.properties.price`, repairs)
    } else {
      repairs.push(`${where}.properties.price: expected an object, dropped`)
      delete out.price
    }
  }

  // Per-kind requirements. Only ever ADDS what a kind cannot work without —
  // other kinds keep whatever survived the whitelist, because shared properties
  // like `showButton` are legitimate on statement fields and forcing `{}` for
  // "all other kinds" would strip them.
  switch (kind) {
    case FieldKindEnum.MULTIPLE_CHOICE:
    case FieldKindEnum.PICTURE_CHOICE:
      out.allowMultiple = coerceBoolean(out.allowMultiple) ?? false
      out.verticalAlignment = coerceBoolean(out.verticalAlignment) ?? true
      out.choices = padLabelled(out.choices, 2, 'Option', `${where}.properties.choices`, repairs)
      break
    case FieldKindEnum.YES_NO:
      if (!Array.isArray(out.choices) || out.choices.length < 2) {
        repairs.push(`${where}.properties: filled yes_no choices`)
        out.choices = [
          { id: freshId(), label: 'Yes' },
          { id: freshId(), label: 'No' }
        ]
      }
      break
    case FieldKindEnum.RATING:
      out.total = coerceNumber(out.total) ?? 5
      if (typeof out.shape !== 'string' || out.shape === '') out.shape = 'star'
      break
    case FieldKindEnum.OPINION_SCALE:
      out.total = coerceNumber(out.total) ?? 10
      break
    case FieldKindEnum.DATE:
    case FieldKindEnum.DATE_RANGE:
      if (typeof out.format !== 'string' || out.format === '') out.format = 'MM/DD/YYYY'
      out.allowTime = coerceBoolean(out.allowTime) ?? false
      break
    case FieldKindEnum.PHONE_NUMBER:
      if (typeof out.defaultCountryCode !== 'string' || out.defaultCountryCode === '') {
        out.defaultCountryCode = 'US'
      }
      break
    case FieldKindEnum.PAYMENT:
      if (typeof out.currency !== 'string' || out.currency === '') out.currency = 'USD'
      if (!isPlainObject(out.price)) out.price = { type: 'number', value: 0 }
      break
    case FieldKindEnum.INPUT_TABLE:
      out.tableColumns = padLabelled(
        out.tableColumns,
        2,
        'Column',
        `${where}.properties.tableColumns`,
        repairs
      )
      break
    default:
      break
  }

  // A `single_choice` or `dropdown` that arrived claiming allowMultiple is
  // contradicting its own name; the alias is the more reliable signal.
  if (forcePickOne && out.allowMultiple !== false) {
    if (out.allowMultiple === true) {
      repairs.push(`${where}.properties: forced allowMultiple off for a pick-one kind`)
    }
    out.allowMultiple = false
  }

  return out
}

/**
 * A title is `any[]` of rich-text nodes, but the model often returns a bare
 * string. Wrap it rather than lose the question.
 */
function sanitizeTitle(value: unknown, where: string, repairs: string[]): any[] {
  if (Array.isArray(value)) {
    const kept = value.filter(entry => entry !== null && entry !== undefined && entry !== '')
    if (kept.length !== value.length) repairs.push(`${where}: dropped empty title entries`)
    return kept
  }
  if (typeof value === 'string' && value.trim() !== '') {
    repairs.push(`${where}: wrapped a string title in an array`)
    return [value]
  }
  return []
}

function sanitizeKind(value: unknown, where: string, repairs: string[]): string {
  if (typeof value === 'string') {
    if (FIELD_KINDS.has(value)) return value
    const snake = toSnakeCase(value)
    if (FIELD_KINDS.has(snake)) {
      repairs.push(`${where}: normalised kind "${value}" to "${snake}"`)
      return snake
    }
    // Aliased BEFORE the fallback, and reported as a mapping rather than as an
    // unknown kind, because the two want different responses from a reader: a
    // mapping is fine, an unknown kind means something drifted.
    const alias = KIND_ALIASES[value] ?? KIND_ALIASES[snake]
    if (alias !== undefined) {
      repairs.push(`${where}: mapped kind "${value}" to "${alias}"`)
      return alias
    }
  }
  repairs.push(
    `${where}: unknown kind ${JSON.stringify(value)}, fell back to "${FieldKindEnum.SHORT_TEXT}"`
  )
  return FieldKindEnum.SHORT_TEXT
}

/**
 * Bring model output into line with what the app actually accepts.
 *
 * Returns the surviving fields plus the list of corrections made. A field is
 * dropped only when there is nothing left to keep — not an object, or a
 * question with no title.
 */
export function sanitizeAIFields(raw: unknown): SanitizeAIFieldsResult {
  const repairs: string[] = []
  if (!Array.isArray(raw)) {
    return { fields: [], repairs: ['expected an array of fields'] }
  }

  const seenIds = new Set<string>()
  const fields: any[] = []

  raw.forEach((entry, index) => {
    const where = `field[${index}]`
    if (!isPlainObject(entry)) {
      repairs.push(`${where}: not an object, dropped`)
      return
    }

    const rawKind = typeof entry.kind === 'string' ? entry.kind : ''
    if (LAYOUT_KINDS.has(rawKind)) {
      repairs.push(`${where}: dropped "${rawKind}" layout block`)
      return
    }

    const kind = sanitizeKind(entry.kind, where, repairs)
    const title = sanitizeTitle(entry.title, `${where}.title`, repairs)

    if (title.length === 0 && !TITLELESS_KINDS.has(kind)) {
      repairs.push(`${where}: no usable title, dropped`)
      return
    }

    const { id, minted } = keepOrMintId(entry.id, seenIds)
    if (minted) repairs.push(`${where}: replaced a missing or duplicate id`)

    const field: Record<string, any> = {
      id,
      title,
      description: sanitizeTitle(entry.description, `${where}.description`, repairs),
      kind,
      validations: sanitizeValidations(entry.validations, where, repairs),
      properties: sanitizeProperties(
        entry.properties,
        kind,
        where,
        repairs,
        PICK_ONE_ALIASES.has(rawKind)
      ),
      layout: isPlainObject(entry.layout) ? entry.layout : null
    }

    // `properties.fields` (group children) are fields in their own right, so
    // they get the same treatment rather than being trusted one level down.
    if (Array.isArray(field.properties.fields)) {
      const nested = sanitizeAIFields(field.properties.fields)
      field.properties.fields = nested.fields
      repairs.push(...nested.repairs.map(entry => `${where}.properties.${entry}`))
    }

    fields.push(field)
  })

  if (fields.length === 0 && raw.length > 0) {
    repairs.push('every field was dropped')
  }

  return { fields, repairs: helper.isValidArray(repairs) ? repairs : [] }
}
