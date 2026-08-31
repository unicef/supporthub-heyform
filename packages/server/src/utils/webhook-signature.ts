import { createHmac } from 'crypto'

/**
 * Outgoing webhook signing (fork-only).
 *
 * Upstream's webhook integration authenticates NOTHING: it POSTs the submission
 * body to whatever URL is configured and that is all. So the endpoint URL was
 * the only thing standing between an anonymous POST and whatever the receiver
 * does with a submission — and a URL held in this database, editable by any
 * workspace admin and logged by every proxy in between, is not a secret.
 *
 * `sha256=<hex>` over `${timestamp}.${body}`, which is the shape Stripe and
 * GitHub use, so a receiver written against either is already almost right.
 *
 * The timestamp is INSIDE the MAC rather than merely travelling next to it.
 * Signing the body alone produces a credential that never expires: capture one
 * valid delivery and it replays for ever. Binding the timestamp in is what lets
 * a stateless receiver enforce a freshness window, and a freshness window is
 * the only bound on replay that does not require the receiver to remember every
 * delivery it has ever seen.
 */
export const WEBHOOK_SIGNATURE_HEADER = 'X-Heyform-Signature'
export const WEBHOOK_TIMESTAMP_HEADER = 'X-Heyform-Timestamp'

/** The exact bytes both sides MAC. Exported so a receiver's tests can reuse it. */
export function webhookSigningInput(timestamp: string, body: string): string {
  return `${timestamp}.${body}`
}

export function signWebhookBody(timestamp: string, body: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret)
    .update(webhookSigningInput(timestamp, body), 'utf8')
    .digest('hex')}`
}

export interface WebhookSignatureHeaders {
  [header: string]: string
}

/**
 * Returns the signature headers for a delivery, or `{}` when no secret is
 * configured.
 *
 * Unsigned delivery stays possible on purpose. This integration also serves
 * ordinary self-hosted users pointing forms at Zapier and the like, and
 * silently breaking them is not ours to do. Fail-closed belongs on the
 * RECEIVER — SupportHub's `/hooks/heyform-ticket` answers 503 when its own
 * secret is unset rather than accepting an unsigned POST.
 *
 * @param nowMs Test seam; production omits it.
 */
export function webhookSignatureHeaders(
  body: string,
  secret: string | undefined,
  nowMs: number = Date.now()
): WebhookSignatureHeaders {
  if (!secret) {
    return {}
  }
  const timestamp = Math.floor(nowMs / 1000).toString()
  return {
    [WEBHOOK_TIMESTAMP_HEADER]: timestamp,
    [WEBHOOK_SIGNATURE_HEADER]: signWebhookBody(timestamp, body, secret)
  }
}
