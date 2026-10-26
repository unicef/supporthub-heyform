import { FieldKindEnum } from '@heyform-inc/shared-types-enums'
import { nanoid } from '@heyform-inc/utils'

/**
 * supporthub-fork: the two repairs upstream's `normalizeAIFields` does not make.
 *
 * Upstream validates the SHAPE of model output (keys, choice objects, ids,
 * titles). It does not repair the field KIND — one `single_choice` fails the
 * whole generation — and it accepts a kind with the properties it cannot work
 * without missing (a `yes_no` with no choices, a `rating` with no total), which
 * then renders broken. So the AI resolver runs:
 *
 *   repairAIFieldKinds → normalizeAIFields (upstream) → fillAIFieldDefaults
 *
 * Every repair is reported so the resolver can log it: a count that starts
 * climbing means the prompt has drifted from the schema.
 */

export interface AIFieldRepairResult {
  fields: unknown[]
  repairs: string[]
}

const FIELD_KINDS = new Set<string>(Object.values(FieldKindEnum))

/**
 * Names other form products use for kinds we do have — and 299 of the fields in
 * HeyForm's own template gallery. `dropdown` maps to `multiple_choice` with no
 * `choiceStyle`: the pick-one semantics survive, only the affordance is lost.
 */
const KIND_ALIASES: Record<string, FieldKindEnum> = {
  single_choice: FieldKindEnum.MULTIPLE_CHOICE,
  dropdown: FieldKindEnum.MULTIPLE_CHOICE,
  paragraph: FieldKindEnum.LONG_TEXT
}

/** Aliases whose whole point is "pick exactly one", so `allowMultiple` is forced off. */
const PICK_ONE_ALIASES = new Set(['single_choice', 'dropdown'])

/** Layout blocks, not questions: dropped rather than degraded to a text box. */
const LAYOUT_KINDS = new Set(['text', 'separator', 'page_break'])

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toSnakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase()
}

/** Before `normalizeAIFields`: map aliased and unknown kinds, drop layout blocks. */
export function repairAIFieldKinds(raw: unknown, where = 'field'): AIFieldRepairResult {
  const repairs: string[] = []
  if (!Array.isArray(raw)) {
    return { fields: raw as unknown[], repairs }
  }

  const fields: unknown[] = []
  raw.forEach((field, index) => {
    const at = `${where}[${index}]`
    if (!isPlainObject(field)) {
      fields.push(field)
      return
    }

    const value = field.kind
    let kind: string = FieldKindEnum.SHORT_TEXT
    let pickOne = false

    if (typeof value === 'string' && FIELD_KINDS.has(value)) {
      kind = value
    } else if (typeof value === 'string' && LAYOUT_KINDS.has(toSnakeCase(value))) {
      repairs.push(`${at}: dropped layout block "${value}"`)
      return
    } else if (typeof value === 'string' && FIELD_KINDS.has(toSnakeCase(value))) {
      kind = toSnakeCase(value)
      repairs.push(`${at}: normalised kind "${value}" to "${kind}"`)
    } else if (typeof value === 'string' && KIND_ALIASES[toSnakeCase(value)] !== undefined) {
      kind = KIND_ALIASES[toSnakeCase(value)]
      pickOne = PICK_ONE_ALIASES.has(toSnakeCase(value))
      repairs.push(`${at}: mapped kind "${value}" to "${kind}"`)
    } else {
      repairs.push(`${at}: unknown kind ${JSON.stringify(value)}, fell back to "${kind}"`)
    }

    const repaired: Record<string, any> = { ...field, kind }
    if (pickOne) {
      repaired.properties = { ...(isPlainObject(field.properties) ? field.properties : {}) }
      repaired.properties.allowMultiple = false
    }
    if (kind === FieldKindEnum.GROUP && isPlainObject(repaired.properties)) {
      const nested = repairAIFieldKinds(repaired.properties.fields, `${at}.fields`)
      repaired.properties = { ...repaired.properties, fields: nested.fields }
      repairs.push(...nested.repairs)
    }
    fields.push(repaired)
  })

  return { fields, repairs }
}

function labelled(label: string): Record<string, string> {
  return { id: nanoid(12), label }
}

function padded(
  existing: unknown,
  noun: string,
  at: string,
  repairs: string[]
): Array<Record<string, any>> {
  const out = Array.isArray(existing) ? [...existing] : []
  if (out.length < 2) {
    repairs.push(`${at}: padded to 2 ${noun.toLowerCase()}s`)
  }
  while (out.length < 2) {
    out.push(labelled(`${noun} ${out.length + 1}`))
  }
  return out
}

/**
 * After `normalizeAIFields`: add what a kind cannot work without. Only ever
 * ADDS; anything the model set and upstream kept is left alone.
 */
export function fillAIFieldDefaults(
  fields: Array<Record<string, any>>,
  where = 'field'
): AIFieldRepairResult {
  const repairs: string[] = []

  const out = fields.map((field, index) => {
    const at = `${where}[${index}].properties`
    const p: Record<string, any> = { ...(field.properties ?? {}) }

    switch (field.kind) {
      case FieldKindEnum.MULTIPLE_CHOICE:
      case FieldKindEnum.PICTURE_CHOICE:
        p.allowMultiple ??= false
        p.verticalAlignment ??= true
        p.choices = padded(p.choices, 'Option', at, repairs)
        break
      case FieldKindEnum.YES_NO:
        if (!Array.isArray(p.choices) || p.choices.length < 2) {
          repairs.push(`${at}: filled yes_no choices`)
          p.choices = [labelled('Yes'), labelled('No')]
        }
        break
      case FieldKindEnum.RATING:
        p.total ??= 5
        p.shape ||= 'star'
        break
      case FieldKindEnum.OPINION_SCALE:
        p.total ??= 10
        break
      case FieldKindEnum.DATE:
      case FieldKindEnum.DATE_RANGE:
        p.format ||= 'MM/DD/YYYY'
        p.allowTime ??= false
        break
      case FieldKindEnum.PHONE_NUMBER:
        p.defaultCountryCode ||= 'US'
        break
      case FieldKindEnum.PAYMENT:
        p.currency ||= 'USD'
        p.price ??= { type: 'number', value: 0 }
        break
      case FieldKindEnum.INPUT_TABLE:
        p.tableColumns = padded(p.tableColumns, 'Column', at, repairs)
        break
      case FieldKindEnum.GROUP:
        if (Array.isArray(p.fields)) {
          const nested = fillAIFieldDefaults(p.fields, `${where}[${index}].fields`)
          p.fields = nested.fields
          repairs.push(...nested.repairs)
        }
        break
      default:
        return field
    }

    return { ...field, properties: p }
  })

  return { fields: out, repairs }
}
