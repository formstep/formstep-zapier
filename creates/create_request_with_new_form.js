'use strict'

const { formstepRpc } = require('../utils/request')
const { withIsoTimes } = require('../utils/request_summary')
const {
  isBlank,
  nonBlankList,
  recipientInputs,
  languageInput,
  requestOptionInputs,
  requestOptionParams,
  requestOutputFields,
  requestSample,
} = require('../utils/request_inputs')

const BLOCKS_EXAMPLE = `[
  { "type": "paragraph", "content": "Hi {{first_name}}, please upload your payslips and pay the fee." },
  { "type": "hiddenField", "key": "first_name" },
  { "type": "file", "key": "payslips", "title": "Your last three payslips", "maxFiles": 3 },
  { "type": "payment", "key": "fee", "title": "Processing fee", "amount": 40, "currency": "EUR" }
]`

/**
 * A JSON input's value. Zapier hands a text input over as a string; a value an
 * earlier step produced may already be parsed. `kind` is what the API wants
 * there, so a wrong shape fails here, naming the input, before any call.
 */
function parseJsonInput(value, label, kind) {
  if (isBlank(value)) return undefined
  let parsed = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      throw new Error(`${label} is not valid JSON.`)
    }
  }
  const isObject = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
  if (kind === 'array' && !Array.isArray(parsed)) throw new Error(`${label} must be a JSON array of blocks.`)
  if (kind === 'object' && !isObject) throw new Error(`${label} must be a JSON object.`)
  return parsed
}

/**
 * The `form` object of `requests.create`: an inline form Formstep builds,
 * publishes and creates the request on in one step. The same definition again
 * reuses the form it made the first time, so the per-recipient values belong
 * in Prefill and Context, never in the name or a block.
 */
function buildFormDefinition(input) {
  const blocks = parseJsonInput(input.formBlocks, 'Form Blocks', 'array')
  if (blocks === undefined) throw new Error('Form Blocks is required: a JSON array of the form’s blocks.')
  const logo = parseJsonInput(input.formLogo, 'Form Logo', 'object')
  const cover = parseJsonInput(input.formCover, 'Form Cover', 'object')
  const theme = parseJsonInput(input.formTheme, 'Form Theme', 'object')
  const settings = parseJsonInput(input.formSettings, 'Form Settings', 'object')
  const translations = parseJsonInput(input.formTranslations, 'Form Translations', 'object')
  return {
    name: input.formName,
    blocks,
    ...(isBlank(input.formLanguage) ? {} : { language: input.formLanguage }),
    ...(logo === undefined ? {} : { logo }),
    ...(cover === undefined ? {} : { cover }),
    ...(isBlank(input.formEmoji) ? {} : { emoji: input.formEmoji }),
    ...(theme === undefined ? {} : { theme }),
    ...(settings === undefined ? {} : { settings }),
    ...(translations === undefined ? {} : { translations }),
  }
}

/** The `requests.create` params for one run: the form definition, its field values and the shared request options. */
function buildCreateParams(input) {
  const form = buildFormDefinition(input)
  const prefill = parseJsonInput(input.prefill, 'Prefill', 'object')
  const context = parseJsonInput(input.context, 'Context', 'object')
  const readonly = nonBlankList(input.readonly)
  return {
    form,
    ...requestOptionParams(input),
    ...(prefill && Object.keys(prefill).length > 0 ? { prefill } : {}),
    ...(context && Object.keys(context).length > 0 ? { context } : {}),
    ...(readonly.length > 0 ? { readonly } : {}),
  }
}

async function perform(z, bundle) {
  const params = buildCreateParams(bundle.inputData)
  return withIsoTimes(await formstepRpc({ z, bundle, method: 'requests.create', params }))
}

const create = {
  key: 'create_request_with_new_form',
  noun: 'Request',
  display: {
    label: 'Create Request With New Form',
    description:
      'Builds a form from the blocks you send, publishes it and assigns it to one recipient in one step, then returns the link. The same form definition again reuses the form it made, so keep the brand in the definition and send it every run.',
  },
  operation: {
    cleanInputData: false,
    inputFields: [
      {
        key: 'formName',
        label: 'Form Name',
        type: 'string',
        required: true,
        helpText:
          'The name on the dashboard and in the browser tab, 1 to 100 characters. Keep it the same for every recipient: a name that changes per run makes a new form every run.',
      },
      {
        key: 'formBlocks',
        label: 'Form Blocks',
        type: 'text',
        required: true,
        placeholder: BLOCKS_EXAMPLE,
        helpText:
          'A JSON array of 1 to 200 blocks, in form order. Each block is `{ "type": …, "key": …, … }` with the parameters of its block type: questions (text, contact, number, date, time, radio, checkbox, select, switch, rating, linearScale, matrix, ranking, pictureChoice, file, signature, decision), documents, payment, scheduleAppointment, content (header, paragraph, image, embedded, table, list, row) and structure (pageDivider, repeatingGroup, hiddenField, calculatedField, logic). Set `key` on every question: answers come back under it. See [Create a form and a request in one call](https://docs.formstep.io/requests/inline-forms/).',
      },
      {
        key: 'formLanguage',
        label: 'Form Language',
        type: 'string',
        required: false,
        helpText: 'The form’s UI language, like en or de. Defaults to English.',
      },
      {
        key: 'formLogo',
        label: 'Form Logo',
        type: 'text',
        required: false,
        helpText:
          'Optional JSON object: an icon, `{ "type": "icon", "name": "HeartIcon" }`, or your own image, `{ "type": "image", "url": "…" }` with the image’s public address as `url`. An image must be a JPEG, PNG or WebP anyone can open; Formstep keeps its own copy.',
      },
      {
        key: 'formCover',
        label: 'Form Cover',
        type: 'text',
        required: false,
        helpText:
          'Optional JSON object: a color, `{ "type": "color", "color": "#0f4c81" }`, or an image, `{ "type": "image", "url": "…", "offsetY": 50 }` with the image’s public address as `url` and `offsetY` from 0 to 100 picking the part that shows.',
      },
      { key: 'formEmoji', label: 'Form Emoji', type: 'string', required: false, helpText: 'One emoji, shown beside the form name.' },
      {
        key: 'formTheme',
        label: 'Form Theme',
        type: 'text',
        required: false,
        helpText:
          'Optional JSON object with a look per color mode, like `{ "light": "solarized-light", "dark": "dracula" }`. A preset id is free on every plan.',
      },
      {
        key: 'formSettings',
        label: 'Form Settings',
        type: 'text',
        required: false,
        helpText:
          'Optional JSON object of form settings, like `{ "showBranding": false, "notifyOnSubmission": true }`. Fields are named by key, and email copy may use `{{key}}`.',
      },
      {
        key: 'formTranslations',
        label: 'Form Translations',
        type: 'text',
        required: false,
        helpText:
          'Optional JSON object that publishes the form in more languages: `{ "de": { "<text as written in the blocks>": "<translation>" } }`. Every string of the form must be there, or Formstep lists the missing ones.',
      },
      ...recipientInputs,
      languageInput,
      {
        key: 'prefill',
        label: 'Prefill',
        type: 'text',
        required: false,
        helpText:
          'Optional JSON object of starting answers, keyed by the block keys, like `{ "company_name": "Acme" }`. A choice question takes option keys, derived from the labels: "Self-employed" becomes `self_employed`.',
      },
      {
        key: 'context',
        label: 'Context',
        type: 'text',
        required: false,
        helpText:
          'Optional JSON object of hidden-field values, keyed by the hiddenField block keys, like `{ "first_name": "Ada", "invoice_total": 1200 }`. Personalise the form here, not in its name or blocks, so every run reuses one form.',
      },
      {
        key: 'readonly',
        label: 'Read-only Field Keys',
        type: 'string',
        list: true,
        required: false,
        helpText: 'Block keys the recipient may see but not change. Each one must also be in Prefill.',
      },
      ...requestOptionInputs,
    ],
    perform,
    sample: {
      ...requestSample,
      form: {
        id: 'j58example0000000000000000',
        name: 'Documents and fee for your mortgage application',
        reused: false,
        fields: [
          { key: 'first_name', type: 'hidden' },
          { key: 'payslips', type: 'file' },
          { key: 'fee', type: 'payment' },
        ],
      },
    },
    outputFields: [
      ...requestOutputFields,
      { key: 'form__id', label: 'Form ID', type: 'string' },
      { key: 'form__name', label: 'Form Name', type: 'string' },
      { key: 'form__reused', label: 'Form Reused', type: 'boolean' },
      { key: 'form__fields[]key', label: 'Form Field Key' },
      { key: 'form__fields[]type', label: 'Form Field Type' },
      { key: 'form__similarForm__id', label: 'Similar Form ID', type: 'string' },
      { key: 'form__similarForm__name', label: 'Similar Form Name', type: 'string' },
    ],
  },
}

module.exports = create
