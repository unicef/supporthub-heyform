import got from 'got'

import { WEBHOOK_SIGNING_SECRET } from '@environments'
import { assertSafeOutboundUrl, webhookSignatureHeaders } from '@utils'

export default {
  id: 'webhook',
  name: 'Webhook',
  description:
    "With webhooks integration, you can send every submission straight to any URL as soon as it's submitted.",
  icon: '/static/webhook.png',
  settings: [
    {
      type: 'url',
      name: 'endpointUrl',
      label: 'Endpoint URL',
      placeholder: 'https://webhook.example.com',
      required: true
    }
  ],
  run: async ({ config, submission, form }) => {
    const endpointUrl = await assertSafeOutboundUrl(config.endpointUrl)

    // Serialised ONCE, here, and sent as a raw `body` rather than through got's
    // `json:` option. The signature has to cover the exact bytes on the wire:
    // if got re-serialised the object we would sign one string and send
    // another, because `JSON.parse` → `JSON.stringify` does not round-trip
    // byte-for-byte (string escaping and number formatting both differ).
    const body = JSON.stringify({
      id: submission.id,
      formId: form.id,
      formName: form.name,
      fields: form.fields,
      answers: submission.answers,
      hiddenFields: submission.hiddenFields,
      variables: submission.variables
    })

    // The secret is global config, not a per-integration setting. A per-form
    // field would sit in this database in plain text, be visible to every
    // workspace admin, and could not be entered anyway — the integration
    // settings UI (`IntegrationSettingsItem.tsx`) renders only `type: 'url'`.
    // See `utils/webhook-signature.ts` for the scheme and for why unsigned
    // delivery is still allowed when the var is unset.
    return got
      .post(endpointUrl.toString(), {
        followRedirect: false,
        headers: {
          'content-type': 'application/json',
          ...webhookSignatureHeaders(body, WEBHOOK_SIGNING_SECRET)
        },
        body
      })
      .text()
  }
}
