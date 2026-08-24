import * as assert from 'assert'

// Imported directly, NOT via the `@utils` barrel: that barrel reaches
// `crypto.ts` → `bcrypt`, whose native binding is absent in a plain local
// install, and this is a pure function that needs none of it. `ai-json.test.ts`
// imports the same way.
import { sanitizeAIFields } from '../src/utils/ai-fields'

const ID = /^[A-Za-z0-9_-]{6,32}$/

function field(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    id: 'abcdefghijkl',
    title: ['A question'],
    description: [],
    kind: 'short_text',
    validations: {},
    properties: {},
    layout: null,
    ...overrides
  }
}

function only(raw: unknown): Record<string, any> {
  const { fields } = sanitizeAIFields(raw)
  assert.strictEqual(fields.length, 1, 'expected exactly one surviving field')
  return fields[0]
}

// ── the invented keys #5 and #6 shipped prompt fixes for ────────────────────

function testDropsUnknownValidationKeys() {
  const out = only([
    field({
      kind: 'email',
      validations: { required: true, format: 'email', max_length: 200, pattern: '.+' }
    })
  ])
  assert.deepStrictEqual(out.validations, { required: true })
}

function testDropsUnknownPropertyKeys() {
  const out = only([
    field({
      kind: 'file_upload',
      properties: { allowed_file_types: ['pdf'], max_files: 3, badge: 'A' }
    })
  ])
  assert.deepStrictEqual(out.properties, { badge: 'A' })
}

function testRecoversSnakeCaseKeysRatherThanDroppingThem() {
  // `default_country_code` has a real camelCase counterpart, so the author's
  // intent survives; a key with no counterpart is still dropped.
  const out = only([
    field({ kind: 'phone_number', properties: { default_country_code: 'GB', nonsense_key: 1 } })
  ])
  assert.strictEqual(out.properties.defaultCountryCode, 'GB')
  assert.ok(!('nonsense_key' in out.properties))
  assert.ok(!('nonsenseKey' in out.properties))
}

function testCoercesNonBooleanAndNonNumericValidations() {
  const out = only([
    field({ validations: { required: 'true', min: '50', max: 'lots', matchExpected: 'nope' } })
  ])
  assert.deepStrictEqual(out.validations, { required: true, min: 50 })
}

// ── string choices, the other shape the model reaches for ───────────────────

function testCoercesStringChoicesToObjects() {
  const out = only([field({ kind: 'multiple_choice', properties: { choices: ['Low', 'High'] } })])
  assert.strictEqual(out.properties.choices.length, 2)
  assert.deepStrictEqual(
    out.properties.choices.map((c: any) => c.label),
    ['Low', 'High']
  )
  for (const choice of out.properties.choices) {
    assert.ok(ID.test(choice.id), `choice id ${choice.id} should be usable`)
  }
}

function testCoercesStringTableColumns() {
  const out = only([
    field({ kind: 'input_table', properties: { tableColumns: ['Skill', 'Proficiency'] } })
  ])
  assert.deepStrictEqual(
    out.properties.tableColumns.map((c: any) => c.label),
    ['Skill', 'Proficiency']
  )
}

function testDropsChoicesWithNoLabel() {
  const out = only([
    field({
      kind: 'multiple_choice',
      properties: { choices: [{ id: 'aaaaaaaaaaaa', label: 'Real' }, { id: 'bbbbbbbbbbbb' }] }
    })
  ])
  // One real choice survives; the labelless one is dropped, then the minimum of
  // two is restored so the field still works in the builder.
  assert.strictEqual(out.properties.choices.length, 2)
  assert.strictEqual(out.properties.choices[0].label, 'Real')
  assert.ok(out.properties.choices[1].label.length > 0)
}

// ── per-kind requirements ───────────────────────────────────────────────────

function testFillsPerKindRequirements() {
  const cases: Array<[string, (p: any) => void]> = [
    [
      'yes_no',
      p =>
        assert.deepStrictEqual(
          p.choices.map((c: any) => c.label),
          ['Yes', 'No']
        )
    ],
    ['rating', p => assert.deepStrictEqual([p.total, p.shape], [5, 'star'])],
    ['opinion_scale', p => assert.strictEqual(p.total, 10)],
    ['date', p => assert.deepStrictEqual([p.format, p.allowTime], ['MM/DD/YYYY', false])],
    ['date_range', p => assert.strictEqual(p.format, 'MM/DD/YYYY')],
    ['phone_number', p => assert.strictEqual(p.defaultCountryCode, 'US')],
    [
      'payment',
      p => assert.deepStrictEqual([p.currency, p.price], ['USD', { type: 'number', value: 0 }])
    ],
    ['input_table', p => assert.strictEqual(p.tableColumns.length, 2)],
    [
      'multiple_choice',
      p => {
        assert.strictEqual(p.choices.length, 2)
        assert.strictEqual(p.allowMultiple, false)
        assert.strictEqual(p.verticalAlignment, true)
      }
    ]
  ]
  for (const [kind, check] of cases) {
    const out = only([field({ kind, properties: {} })])
    assert.strictEqual(out.kind, kind)
    try {
      check(out.properties)
    } catch (error) {
      throw new Error(`kind "${kind}": ${(error as Error).message}`)
    }
  }
}

function testDoesNotInventPropertiesForKindsThatNeedNone() {
  // file_upload has no configurable properties, and forcing `{}` on "every other
  // kind" would strip legitimate shared ones — so this asserts both halves.
  const bare = only([field({ kind: 'file_upload', properties: {} })])
  assert.deepStrictEqual(bare.properties, {})

  const shared = only([field({ kind: 'statement', properties: { showButton: true } })])
  assert.strictEqual(shared.properties.showButton, true)
}

function testPreservesModelSuppliedPerKindValues() {
  const out = only([field({ kind: 'rating', properties: { total: 3, shape: 'heart' } })])
  assert.deepStrictEqual([out.properties.total, out.properties.shape], [3, 'heart'])
}

// ── ids: the constraint that makes this safe on createFieldsWithAI ──────────

function testKeepsValidIdsSoLogicReferencesSurvive() {
  const out = only([field({ id: 'keepThisId12' })])
  assert.strictEqual(out.id, 'keepThisId12')
}

function testReplacesDuplicateAndMalformedIds() {
  const { fields } = sanitizeAIFields([
    field({ id: 'sameIdTwice1', title: ['One'] }),
    field({ id: 'sameIdTwice1', title: ['Two'] }),
    field({ id: '', title: ['Three'] }),
    field({ id: 42 as any, title: ['Four'] })
  ])
  assert.strictEqual(fields.length, 4)
  assert.strictEqual(fields[0].id, 'sameIdTwice1')
  const ids = fields.map((f: any) => f.id)
  assert.strictEqual(new Set(ids).size, 4, 'ids must be distinct')
  for (const id of ids) assert.ok(ID.test(id), `id ${id} should be usable`)
}

// ── kind and title handling ─────────────────────────────────────────────────

function testFallsBackToShortTextForUnknownKind() {
  const out = only([field({ kind: 'signature_pad' })])
  assert.strictEqual(out.kind, 'short_text')
}

function testNormalisesCamelCaseKind() {
  const out = only([field({ kind: 'longText' })])
  assert.strictEqual(out.kind, 'long_text')
}

function testWrapsStringTitle() {
  const out = only([field({ title: 'Just a string' })])
  assert.deepStrictEqual(out.title, ['Just a string'])
}

function testDropsQuestionWithNoTitleButKeepsStatement() {
  const { fields } = sanitizeAIFields([
    field({ title: [], kind: 'short_text' }),
    field({ title: [], kind: 'thank_you' })
  ])
  assert.strictEqual(fields.length, 1)
  assert.strictEqual(fields[0].kind, 'thank_you')
}

// ── hostile / malformed input must not throw ────────────────────────────────

function testSurvivesGarbage() {
  for (const input of [null, undefined, 42, 'a string', {}, [null], ['x'], [[]]]) {
    const result = sanitizeAIFields(input as any)
    assert.ok(Array.isArray(result.fields), `fields must be an array for ${JSON.stringify(input)}`)
    assert.ok(Array.isArray(result.repairs))
  }
  assert.deepStrictEqual(sanitizeAIFields([]).fields, [])
}

function testNonObjectPropertiesAndValidations() {
  const out = only([field({ validations: 'nope' as any, properties: [] as any })])
  assert.deepStrictEqual(out.validations, {})
  assert.deepStrictEqual(out.properties, {})
}

function testSanitisesNestedGroupChildren() {
  const out = only([
    field({
      kind: 'group',
      title: ['A group'],
      properties: {
        fields: [
          field({ id: 'child1234567', kind: 'multiple_choice', properties: { choices: ['A'] } })
        ]
      }
    })
  ])
  const child = out.properties.fields[0]
  assert.strictEqual(child.kind, 'multiple_choice')
  assert.strictEqual(child.properties.choices.length, 2, 'nested choices get the same padding')
}

// ── the repair log, which is the drift signal ───────────────────────────────

function testReportsNoRepairsForCompliantOutput() {
  const compliant = [
    field({ kind: 'email', validations: { required: true } }),
    field({
      id: 'secondField1',
      kind: 'multiple_choice',
      properties: {
        allowMultiple: false,
        verticalAlignment: true,
        choices: [
          { id: 'choiceOne123', label: 'A' },
          { id: 'choiceTwo123', label: 'B' }
        ]
      }
    })
  ]
  const { fields, repairs } = sanitizeAIFields(compliant)
  assert.strictEqual(fields.length, 2)
  assert.deepStrictEqual(repairs, [], `compliant output must need no repairs, got: ${repairs}`)
}

function testReportsWhatItRepaired() {
  const { repairs } = sanitizeAIFields([field({ kind: 'email', validations: { format: 'email' } })])
  assert.ok(
    repairs.some(r => r.includes('format')),
    `expected a repair mentioning "format", got: ${JSON.stringify(repairs)}`
  )
}

function run() {
  testDropsUnknownValidationKeys()
  testDropsUnknownPropertyKeys()
  testRecoversSnakeCaseKeysRatherThanDroppingThem()
  testCoercesNonBooleanAndNonNumericValidations()
  testCoercesStringChoicesToObjects()
  testCoercesStringTableColumns()
  testDropsChoicesWithNoLabel()
  testFillsPerKindRequirements()
  testDoesNotInventPropertiesForKindsThatNeedNone()
  testPreservesModelSuppliedPerKindValues()
  testKeepsValidIdsSoLogicReferencesSurvive()
  testReplacesDuplicateAndMalformedIds()
  testFallsBackToShortTextForUnknownKind()
  testNormalisesCamelCaseKind()
  testWrapsStringTitle()
  testDropsQuestionWithNoTitleButKeepsStatement()
  testSurvivesGarbage()
  testNonObjectPropertiesAndValidations()
  testSanitisesNestedGroupChildren()
  testReportsNoRepairsForCompliantOutput()
  testReportsWhatItRepaired()
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
