import type { FormTheme } from '@heyform-inc/shared-types-enums'

/**
 * A new form starts from its workspace's brand kit theme.
 *
 * Upstream HeyForm saves a new form with no theme, so it renders in the
 * default blue, and the brand kit is only a theme an editor can pick in the
 * designer. Here a form created WITHOUT a theme of its own takes the brand
 * kit's theme. A form that already carries one (a duplicate, or a template
 * with its own look) keeps it. No brand kit, or one without a theme, leaves
 * the form unchanged.
 */
export function withBrandKitTheme<T extends Record<string, any>>(
  form: T,
  brandKitTheme: FormTheme | null | undefined
): T & { themeSettings?: Record<string, any> | null } {
  const own: FormTheme | undefined = form.themeSettings?.theme
  if (own && Object.keys(own).length > 0) {
    return form
  }
  if (!brandKitTheme || Object.keys(brandKitTheme).length === 0) {
    return form
  }
  return {
    ...form,
    themeSettings: {
      ...(form.themeSettings ?? {}),
      theme: { ...brandKitTheme }
    }
  }
}
