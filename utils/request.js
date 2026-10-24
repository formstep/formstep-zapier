'use strict'

// Deployment origin. Defaults to Formstep cloud; override via the BASE_URL
// Zapier env var for a self-hosted deployment. Must match the origin whose
// /oauth/* endpoints back this integration's OAuth config.
const BASE_URL = String(process.env.BASE_URL || 'https://api.formstep.io').replace(/\/+$/, '')

/**
 * Call a Formstep JSON-RPC method and return its `data`.
 *
 * The API answers `{ ok: true, data }` or `{ ok: false, error: { code, message } }`.
 * UNAUTHORIZED becomes RefreshAuthError so Zapier refreshes the token and
 * retries; RATE_LIMITED becomes ThrottledError so Zapier backs off. Every other
 * failure throws an Error carrying the Formstep `code`, so a caller can branch
 * on it without matching message text.
 */
async function formstepRpc({ z, bundle, method, params }) {
  const response = await z.request({
    url: `${BASE_URL}/api/v1`,
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${bundle.authData.access_token}`,
      accept: 'application/json',
    },
    body: JSON.stringify({ method, params: params || {} }),
    skipThrowForStatus: true,
  })

  // z.request parses a JSON body into response.data; anything else leaves it undefined.
  const payload = response.data
  if (payload?.ok === true) return payload.data

  const code = payload?.error?.code || `HTTP_${response.status || 'UNKNOWN'}`
  const message = payload?.error?.message || `Formstep API error (${code})`
  const details = payload?.error?.details
  if (code === 'UNAUTHORIZED') throw new z.errors.RefreshAuthError(message)
  if (code === 'RATE_LIMITED') {
    // Formstep says how long to wait; Zapier takes the delay in seconds.
    const retryAfterMs = details?.retryAfterMs
    throw new z.errors.ThrottledError(message, typeof retryAfterMs === 'number' ? Math.ceil(retryAfterMs / 1000) : undefined)
  }

  const error = new Error(`${code}: ${message}${describeDetails(details)}`)
  error.code = code
  throw error
}

/**
 * The specific cause Formstep gives behind a reused code: the reason, the
 * parameter it concerns and the keys that would have worked, as Zapier shows
 * them after the message. Empty when Formstep gives none.
 */
function describeDetails(details) {
  if (!details) return ''
  const causes = [
    details.reason ? `Reason: ${details.reason}` : undefined,
    details.field ? `Field: ${details.field}` : undefined,
    Array.isArray(details.validKeys) && details.validKeys.length > 0 ? `Valid keys: ${details.validKeys.join(', ')}` : undefined,
  ].filter(Boolean)
  return causes.length > 0 ? ` (${causes.join('. ')})` : ''
}

module.exports = { formstepRpc, BASE_URL }
