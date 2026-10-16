// BASE_URL is read at module load in utils/request, so set it before requiring.
process.env.BASE_URL = 'https://fake.formstep.test'

const nock = require('nock')
const create = require('../creates/create_request_with_new_form')
const { makeZ } = require('./helpers')

const FAKE_BASE = process.env.BASE_URL
const authData = { access_token: 'fbo_access' }

const BLOCKS = [
  { type: 'hiddenField', key: 'first_name' },
  { type: 'file', key: 'payslips', title: 'Your last three payslips', maxFiles: 3 },
  { type: 'select', key: 'employment', title: 'Employment', options: ['Employed', 'Self-employed'] },
]

const CREATED = {
  id: 'req_1',
  status: 'pending',
  url: 'https://form.formstep.test/r/rq_1',
  deliveryStatus: 'not_requested',
  expiresAt: Date.parse('2026-11-15T00:00:00Z'),
  createdAt: Date.parse('2026-10-16T00:00:00Z'),
  deduplicated: false,
  form: { id: 'form_new', name: 'Documents', reused: false, fields: [{ key: 'first_name', type: 'hidden' }, { key: 'payslips', type: 'file' }] },
}

/** Runs perform against a fake Formstep and returns the requests.create params it sent. */
async function createParamsFor(inputData) {
  let sent
  nock(FAKE_BASE)
    .post('/api/v1', (body) => {
      if (body.method !== 'requests.create') return false
      sent = body.params
      return true
    })
    .reply(200, { ok: true, data: CREATED })
  const result = await create.operation.perform(makeZ(), { authData, inputData: { formName: 'Documents', formBlocks: JSON.stringify(BLOCKS), ...inputData } })
  return { sent, result }
}

describe('create_request_with_new_form definition', () => {
  test('asks for a form name and blocks, and needs no form picker', () => {
    expect(create.key).toBe('create_request_with_new_form')
    const byKey = Object.fromEntries(create.operation.inputFields.map((field) => [field.key, field]))
    expect(byKey.formName).toMatchObject({ required: true })
    expect(byKey.formBlocks).toMatchObject({ required: true, type: 'text' })
    expect(Object.keys(byKey)).toEqual(expect.arrayContaining(['formLanguage', 'formLogo', 'formCover', 'formEmoji', 'formTheme', 'formSettings', 'formTranslations']))
    expect(byKey.formId).toBeUndefined()
    expect(byKey.baselineFormId).toBeUndefined()
    expect(Object.keys(byKey)).toEqual(
      expect.arrayContaining(['recipientEmail', 'recipientName', 'language', 'prefill', 'context', 'readonly', 'delivery', 'reminders', 'expiresAt', 'externalId', 'metadata', 'test'])
    )
    expect(create.operation.outputFields.map((field) => field.key)).toEqual(expect.arrayContaining(['url', 'form__id', 'form__reused']))
    expect(create.operation.sample.form.id).toBeTruthy()
  })
})

describe('create_request_with_new_form perform', () => {
  afterEach(() => nock.cleanAll())

  test('sends the form definition in place of a formId', async () => {
    const { sent, result } = await createParamsFor({})
    expect(sent).toEqual({ form: { name: 'Documents', blocks: BLOCKS } })
    expect(result.form.id).toBe('form_new')
    expect(result.expiresAt).toBe('2026-11-15T00:00:00.000Z')
  })

  test('sends the language, brand, theme, settings and translations, and the request options', async () => {
    const { sent } = await createParamsFor({
      formLanguage: 'de',
      formLogo: '{ "type": "image", "url": "https://acme.example/logo.png" }',
      formCover: '{ "type": "color", "color": "#0f4c81" }',
      formEmoji: '🏦',
      formTheme: '{ "light": "solarized-light" }',
      formSettings: { showBranding: false },
      formTranslations: '{ "en": { "Employment": "Employment" } }',
      recipientEmail: 'ada@example.com',
      recipientName: 'Ada',
      prefill: '{ "employment": "self_employed" }',
      context: '{ "first_name": "Ada" }',
      readonly: ['employment'],
      delivery: 'email',
      externalId: 'case-7',
      test: true,
    })
    expect(sent).toEqual({
      form: {
        name: 'Documents',
        blocks: BLOCKS,
        language: 'de',
        logo: { type: 'image', url: 'https://acme.example/logo.png' },
        cover: { type: 'color', color: '#0f4c81' },
        emoji: '🏦',
        theme: { light: 'solarized-light' },
        settings: { showBranding: false },
        translations: { en: { Employment: 'Employment' } },
      },
      recipient: { email: 'ada@example.com', name: 'Ada' },
      prefill: { employment: 'self_employed' },
      context: { first_name: 'Ada' },
      readonly: ['employment'],
      delivery: 'email',
      externalId: 'case-7',
      idempotencyKey: 'case-7',
      test: true,
    })
  })

  test.each([
    ['blocks that are not JSON', { formBlocks: '[{ type: text }]' }, /Form Blocks is not valid JSON/],
    ['blocks that are not an array', { formBlocks: '{ "type": "text" }' }, /Form Blocks must be a JSON array/],
    ['missing blocks', { formBlocks: '' }, /Form Blocks is required/],
    ['a prefill that is not an object', { prefill: '["a"]' }, /Prefill must be a JSON object/],
    ['settings that are not JSON', { formSettings: 'showBranding: false' }, /Form Settings is not valid JSON/],
    ['a logo that is not an object', { formLogo: '"HeartIcon"' }, /Form Logo must be a JSON object/],
  ])('fails before calling Formstep on %s', async (_case, inputData, message) => {
    const scope = nock(FAKE_BASE).post('/api/v1').reply(200, { ok: true, data: CREATED })
    await expect(
      create.operation.perform(makeZ(), { authData, inputData: { formName: 'Documents', formBlocks: JSON.stringify(BLOCKS), ...inputData } })
    ).rejects.toThrow(message)
    expect(scope.isDone()).toBe(false)
  })

  test('surfaces an inline form refusal with its code', async () => {
    nock(FAKE_BASE)
      .post('/api/v1')
      .reply(200, { ok: false, error: { code: 'VALIDATION_ERROR', message: 'blocks.1: unknown block type "upload"', details: { reason: 'INLINE_FORM_INVALID' } } })
    await expect(
      create.operation.perform(makeZ(), { authData, inputData: { formName: 'Documents', formBlocks: '[{ "type": "upload" }]' } })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })
})
