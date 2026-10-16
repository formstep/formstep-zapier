'use strict'

// The inputs and params every Create Request action shares, whether it sends
// a published form (create_request) or builds one in the same call
// (create_request_with_new_form).

const DELIVERY_CHOICES = {
  none: 'None: the Zap sends the link itself',
  email: 'Email: Formstep sends the invitation',
}

function isBlank(value) {
  return value === undefined || value === null || value === ''
}

function nonBlankList(value) {
  if (isBlank(value)) return []
  return (Array.isArray(value) ? value : [value]).filter((entry) => !isBlank(entry))
}

function parseExpiresAt(value) {
  const expiresAt = Date.parse(value)
  if (Number.isNaN(expiresAt)) throw new Error(`Expires At is not a date Zapier could parse: ${value}`)
  return expiresAt
}

const recipientInputs = [
  {
    key: 'recipientEmail',
    label: 'Recipient Email',
    type: 'string',
    required: false,
    helpText: 'Required for email delivery and reminders.',
  },
  { key: 'recipientName', label: 'Recipient Name', type: 'string', required: false },
]

const languageInput = {
  key: 'language',
  label: 'Language',
  type: 'string',
  required: false,
  helpText: 'A published language of the form, like en or de. Leave empty for the form default.',
}

/** Delivery, reminders, expiry, External ID, metadata and test, in the order both actions show them. */
const requestOptionInputs = [
  {
    key: 'delivery',
    label: 'Delivery',
    type: 'string',
    required: false,
    choices: DELIVERY_CHOICES,
    default: 'none',
    helpText:
      'With None, send the Request URL this step returns through your own channel. Email needs a Pro or Business plan. With either, a filled-in Recipient Email gets the form’s scheduled reminders if the form has reminders on.',
  },
  {
    key: 'reminders',
    label: 'Reminders',
    type: 'string',
    list: true,
    required: false,
    helpText: 'Idle offsets like 2d or 5d, up to five. Leave empty to keep the form’s reminder schedule.',
  },
  {
    key: 'expiresAt',
    label: 'Expires At',
    type: 'datetime',
    required: false,
    helpText: 'Defaults to 30 days from now; at most 365 days.',
  },
  {
    key: 'externalId',
    label: 'External ID',
    type: 'string',
    required: false,
    helpText:
      'Your id for this request, for Find Request later. It is also the idempotency key: a re-run Zap with the same External ID and inputs gets the same request back instead of creating a second one. The same External ID with different inputs within 30 days fails, so use a new one for each request.',
  },
  {
    key: 'metadata',
    label: 'Metadata',
    dict: true,
    required: false,
    helpText: 'Caller-only bookkeeping. Never shown to the recipient; echoed on every request event.',
  },
  {
    key: 'test',
    label: 'Test Request',
    type: 'boolean',
    required: false,
    helpText: 'A test request sends no email, counts against no quota, and starts no Zap: request triggers fire for real requests only.',
  },
]

/**
 * The `requests.create` params that do not depend on the form: recipient,
 * language, delivery, reminders, expiry, External ID, metadata and test.
 * `idempotencyKey` is the External ID, so a replayed or re-run Zap gets the
 * request it already created back (`deduplicated: true`) instead of sending
 * the recipient a second link.
 */
function requestOptionParams(input) {
  const reminders = nonBlankList(input.reminders)
  const recipient = {
    ...(isBlank(input.recipientEmail) ? {} : { email: input.recipientEmail }),
    ...(isBlank(input.recipientName) ? {} : { name: input.recipientName }),
  }
  const metadata = input.metadata && typeof input.metadata === 'object' ? input.metadata : {}
  const expiresAt = isBlank(input.expiresAt) ? undefined : parseExpiresAt(input.expiresAt)
  return {
    ...(Object.keys(recipient).length > 0 ? { recipient } : {}),
    ...(isBlank(input.language) ? {} : { language: input.language }),
    ...(isBlank(input.externalId) ? {} : { externalId: input.externalId, idempotencyKey: input.externalId }),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    ...(isBlank(input.delivery) ? {} : { delivery: input.delivery }),
    ...(reminders.length > 0 ? { reminders } : {}),
    ...(expiresAt === undefined ? {} : { expiresAt }),
    ...(input.test === true ? { test: true } : {}),
  }
}

/** The created-request outputs both actions share. */
const requestOutputFields = [
  { key: 'id', label: 'Request ID', type: 'string' },
  { key: 'status', label: 'Status', type: 'string' },
  { key: 'url', label: 'Request URL', type: 'string' },
  { key: 'deliveryStatus', label: 'Delivery Status', type: 'string' },
  { key: 'expiresAt', label: 'Expires At', type: 'datetime' },
  { key: 'createdAt', label: 'Created At', type: 'datetime' },
  { key: 'externalId', label: 'External ID', type: 'string' },
  { key: 'deduplicated', label: 'Deduplicated', type: 'boolean' },
]

const requestSample = {
  id: 'req_example000000000000',
  status: 'pending',
  url: 'https://form.formstep.io/r/rq_example',
  deliveryStatus: 'not_requested',
  expiresAt: '2026-06-25T12:00:00.000Z',
  createdAt: '2026-05-26T12:00:00.000Z',
  externalId: 'run-42',
  deduplicated: false,
}

module.exports = {
  isBlank,
  nonBlankList,
  recipientInputs,
  languageInput,
  requestOptionInputs,
  requestOptionParams,
  requestOutputFields,
  requestSample,
}
