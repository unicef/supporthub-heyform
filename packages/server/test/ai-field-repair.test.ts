import * as assert from 'assert'

// Imported directly, NOT via the `@utils` barrel: that barrel reaches
// `crypto.ts` → `bcrypt`, whose native binding is absent in a plain local
// install, and these are pure functions that need none of it.
import { fillAIFieldDefaults, repairAIFieldKinds } from '../src/utils/ai-field-repair'
import { normalizeAIFields } from '../src/utils/ai-fields'

function field(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    id: 'abcdefghijkl',
    title: ['A question'],
    kind: 'short_text',
    properties: {},
    ...overrides
  }
}

/** The resolver's pipeline, minus rich-text sanitising. */
function pipeline(raw: unknown): { fields: Record<string, any>[]; repairs: string[] } {
  const kinds = repairAIFieldKinds(raw)
  const defaults = fillAIFieldDefaults(normalizeAIFields(kinds.fields) as Record<string, any>[])
  return { fields: defaults.fields as Record<string, any>[], repairs: [...kinds.repairs, ...defaults.repairs] }
}

function only(raw: unknown): Record<string, any> {
  const { fields } = pipeline(raw)
  assert.strictEqual(fields.length, 1, 'expected exactly one surviving field')
  return fields[0]
}

// ── kinds: upstream's schema rejects the WHOLE generation over one of these ──

function testUpstreamAloneRejectsAnAlias() {
  // The reason this module exists: without the kind pass, one alias fails all.
  assert.throws(() => normalizeAIFields([field({ kind: 'single_choice' })]))
}

function testMapsSingleChoiceToMultipleChoicePickOne() {
  const out = only([
    field({ kind: 'single_choice', properties: { allowMultiple: true, choices: [{ id: 'aaaaaa', label: 'A' }, { id: 'bbbbbb', label: 'B' }] } })
  ])
  assert.strictEqual(out.kind, 'multiple_choice')
  assert.strictEqual(out.properties.allowMultiple, false)
}

function testMapsDropdownWithoutInventingChoiceStyle() {
  const out = only([field({ kind: 'dropdown', properties: { choices: [{ id: 'aaaaaa', label: 'A' }, { id: 'bbbbbb', label: 'B' }] } })])
  assert.strictEqual(out.kind, 'multiple_choice')
  assert.strictEqual(out.properties.allowMultiple, false)
  assert.strictEqual(out.properties.choiceStyle, undefined)
}

function testMapsParagraphToLongText() {
  assert.strictEqual(only([field({ kind: 'paragraph' })]).kind, 'long_text')
}

function testNormalisesCaseOfAKnownKind() {
  assert.strictEqual(only([field({ kind: 'ShortText' })]).kind, 'short_text')
}

function testDropsLayoutBlocks() {
  const { fields, repairs } = pipeline([field({ kind: 'text' }), field({ id: 'zzzzzzzzzzzz', kind: 'separator' }), field({ id: 'yyyyyyyyyyyy' })])
  assert.strictEqual(fields.length, 1)
  assert.ok(repairs.some(r => r.includes('dropped layout block "text"')))
}

function testFallsBackForGenuinelyUnknownKinds() {
  const { fields, repairs } = pipeline([field({ kind: 'slider' })])
  assert.strictEqual(fields[0].kind, 'short_text')
  assert.ok(repairs.some(r => r.includes('unknown kind "slider"')))
}

function testAliasReportedAsMappingNotAsUnknownKind() {
  const { repairs } = pipeline([field({ kind: 'dropdown' })])
  assert.ok(repairs.some(r => r.includes('mapped kind "dropdown"')))
  assert.ok(!repairs.some(r => r.includes('unknown kind')))
}

function testRepairsKindsInsideGroups() {
  const out = only([
    field({ kind: 'group', properties: { fields: [field({ id: 'childchild01', kind: 'paragraph' })] } })
  ])
  assert.strictEqual(out.properties.fields[0].kind, 'long_text')
}

// ── defaults: upstream keeps these, and they render broken ───────────────────

function testFillsYesNoChoices() {
  const out = only([field({ kind: 'yes_no' })])
  assert.deepStrictEqual(out.properties.choices.map((c: any) => c.label), ['Yes', 'No'])
  assert.ok(out.properties.choices.every((c: any) => /^[A-Za-z0-9_-]{12}$/.test(c.id)))
}

function testPadsChoicesAndColumnsToTwo() {
  const choice = only([field({ kind: 'multiple_choice', properties: { choices: [{ id: 'aaaaaa', label: 'Only' }] } })])
  assert.deepStrictEqual(choice.properties.choices.map((c: any) => c.label), ['Only', 'Option 2'])
  const table = only([field({ kind: 'input_table' })])
  assert.strictEqual(table.properties.tableColumns.length, 2)
}

function testFillsScalarDefaults() {
  assert.deepStrictEqual(only([field({ kind: 'rating' })]).properties, { total: 5, shape: 'star' })
  assert.strictEqual(only([field({ kind: 'opinion_scale' })]).properties.total, 10)
  assert.strictEqual(only([field({ kind: 'date' })]).properties.format, 'MM/DD/YYYY')
  assert.strictEqual(only([field({ kind: 'phone_number' })]).properties.defaultCountryCode, 'US')
  assert.deepStrictEqual(only([field({ kind: 'payment' })]).properties.price, { type: 'number', value: 0 })
}

function testKeepsWhatTheModelSet() {
  const out = only([field({ kind: 'rating', properties: { total: 3, shape: 'heart' } })])
  assert.deepStrictEqual(out.properties, { total: 3, shape: 'heart' })
}

function testReportsNoRepairsForCompliantOutput() {
  const { repairs } = pipeline([
    field(),
    field({ id: 'bbbbbbbbbbbb', kind: 'yes_no', properties: { choices: [{ id: 'yyyyyy', label: 'Yes' }, { id: 'nnnnnn', label: 'No' }] } })
  ])
  assert.deepStrictEqual(repairs, [])
}

function run() {
  testUpstreamAloneRejectsAnAlias()
  testMapsSingleChoiceToMultipleChoicePickOne()
  testMapsDropdownWithoutInventingChoiceStyle()
  testMapsParagraphToLongText()
  testNormalisesCaseOfAKnownKind()
  testDropsLayoutBlocks()
  testFallsBackForGenuinelyUnknownKinds()
  testAliasReportedAsMappingNotAsUnknownKind()
  testRepairsKindsInsideGroups()
  testFillsYesNoChoices()
  testPadsChoicesAndColumnsToTwo()
  testFillsScalarDefaults()
  testKeepsWhatTheModelSet()
  testReportsNoRepairsForCompliantOutput()
}

if (require.main === module) {
  try {
    run()
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(error)
    process.exitCode = 1
  }
}
