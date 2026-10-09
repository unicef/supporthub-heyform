import * as assert from 'assert'

import { withBrandKitTheme } from '../src/utils/brand-kit-theme'

const TEAL = { buttonBackground: '#0193ba', buttonTextColor: '#ffffff', answerTextColor: '#0193ba' }

function testNewFormTakesBrandKitTheme() {
  const form = { teamId: 't1', name: 'Untitled' }
  const result = withBrandKitTheme(form, TEAL)
  assert.deepStrictEqual(result.themeSettings, { theme: TEAL })
  assert.strictEqual(result.name, 'Untitled')
  // The brand kit object is copied, not shared, so editing one form's theme
  // can never write through to the brand kit.
  assert.notStrictEqual((result.themeSettings as any).theme, TEAL)
}

function testNullThemeSettingsTakesBrandKitTheme() {
  const result = withBrandKitTheme({ themeSettings: null }, TEAL)
  assert.deepStrictEqual(result.themeSettings, { theme: TEAL })
}

function testEmptyThemeTakesBrandKitTheme() {
  const result = withBrandKitTheme({ themeSettings: { theme: {} } }, TEAL)
  assert.deepStrictEqual(result.themeSettings, { theme: TEAL })
}

function testFormWithItsOwnThemeKeepsIt() {
  // A duplicate, or a template with its own look.
  const own = { buttonBackground: '#ff0000' }
  const form = { themeSettings: { theme: own } }
  assert.strictEqual(withBrandKitTheme(form, TEAL), form)
}

function testNoBrandKitLeavesFormUnchanged() {
  const form = { teamId: 't1' }
  assert.strictEqual(withBrandKitTheme(form, null), form)
  assert.strictEqual(withBrandKitTheme(form, undefined), form)
  assert.strictEqual(withBrandKitTheme(form, {}), form)
}

function testOtherThemeSettingsArePreserved() {
  const form = { themeSettings: { theme: {}, other: 'kept' } as any }
  const result = withBrandKitTheme(form, TEAL)
  assert.deepStrictEqual(result.themeSettings, { theme: TEAL, other: 'kept' })
}

async function run() {
  testNewFormTakesBrandKitTheme()
  testNullThemeSettingsTakesBrandKitTheme()
  testEmptyThemeTakesBrandKitTheme()
  testFormWithItsOwnThemeKeepsIt()
  testNoBrandKitLeavesFormUnchanged()
  testOtherThemeSettingsArePreserved()
}

if (require.main === module) {
  run().catch(error => {
    // eslint-disable-next-line no-console
    console.error(error)
    process.exitCode = 1
  })
}
