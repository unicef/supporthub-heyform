import * as assert from 'assert'
import { createHmac } from 'crypto'

import {
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  signWebhookBody,
  webhookSignatureHeaders,
  webhookSigningInput
} from '../src/utils/webhook-signature'

const SECRET = 'a-test-secret-that-is-long-enough-32'
const BODY = '{"id":"sub_1","formId":"aZv460T4"}'

function testSigningInputBindsTheTimestamp() {
  assert.strictEqual(webhookSigningInput('1756600000', BODY), `1756600000.${BODY}`)

  // The whole point of the scheme: the same body at a different time is a
  // different signature. If these matched, a captured delivery would replay for
  // ever and the receiver's freshness window would be unenforceable.
  assert.notStrictEqual(
    signWebhookBody('1756600000', BODY, SECRET),
    signWebhookBody('1756600060', BODY, SECRET)
  )
}

function testSignatureShape() {
  const signature = signWebhookBody('1756600000', BODY, SECRET)
  assert.ok(signature.startsWith('sha256='), 'signature is prefixed')
  assert.ok(/^sha256=[0-9a-f]{64}$/.test(signature), `unexpected shape: ${signature}`)

  // Pinned against an independent HMAC computation rather than a hardcoded
  // digest, so the test states the CONTRACT (hex HMAC-SHA256 over
  // `timestamp.body`) instead of just echoing whatever the implementation does.
  const expected = createHmac('sha256', SECRET).update(`1756600000.${BODY}`, 'utf8').digest('hex')
  assert.strictEqual(signature, `sha256=${expected}`)
}

function testDifferentSecretDifferentSignature() {
  assert.notStrictEqual(
    signWebhookBody('1756600000', BODY, SECRET),
    signWebhookBody('1756600000', BODY, `${SECRET}-other`)
  )
}

function testHeadersOmittedWithoutASecret() {
  assert.deepStrictEqual(webhookSignatureHeaders(BODY, undefined), {})
  assert.deepStrictEqual(webhookSignatureHeaders(BODY, ''), {})
}

function testHeadersPresentWithASecret() {
  // 1756600000123 ms → 1756600000 s. Pinned so the seconds truncation is
  // actually asserted: sending milliseconds would put the receiver's ±300s
  // window a thousand-fold out and reject every delivery.
  const headers = webhookSignatureHeaders(BODY, SECRET, 1756600000123)
  assert.strictEqual(headers[WEBHOOK_TIMESTAMP_HEADER], '1756600000')
  assert.strictEqual(headers[WEBHOOK_SIGNATURE_HEADER], signWebhookBody('1756600000', BODY, SECRET))
}

function run() {
  testSigningInputBindsTheTimestamp()
  testSignatureShape()
  testDifferentSecretDifferentSignature()
  testHeadersOmittedWithoutASecret()
  testHeadersPresentWithASecret()
}

if (require.main === module) {
  run()
  // eslint-disable-next-line no-console
  console.log('webhook-signature: ok')
}
