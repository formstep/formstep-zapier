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
  const settings = parseJsonInput(input.formSettings, 'Form Settings', 'object')
  const theme = parseJsonInput(input.formTheme, 'Form Theme', 'object')
  return {
    name: input.formName,
    blocks,
    ...(isBlank(input.baselineFormId) ? {} : { baseline: input.baselineFormId }),
    ...(isBlank(input.formLanguage) ? {} : { language: input.formLanguage }),
    ...(settings === undefined ? {} : { settings }),
    ...(theme === undefined ? {} : { theme }),
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
      'Builds a form from the blocks you send, publishes it and assigns it to one recipient in one step, then returns the link. The same form definition again reuses the form it made.',
  },
  operation: {
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
        key: 'baselineFormId',
        label: 'Baseline Form',
        type: 'string',
        required: false,
        dynamic: 'form_list.id.label',
        helpText: 'A form to copy the logo, cover, theme, language, emails and notification settings from. Its questions are not copied.',
      },
      {
        key: 'formLanguage',
        label: 'Form Language',
        type: 'string',
        required: false,
        helpText: 'The form’s UI language, like en or de. Defaults to the baseline form’s, else English.',
      },
      {
        key: 'formTheme',
        label: 'Form Theme',
        type: 'text',
        required: false,
        helpText:
          'Optional JSON object with a look per color mode, like `{ "light": "solarized-light", "dark": "dracula" }`. A preset id is free on every plan. Wins over the baseline form’s theme for the mode it sets.',
      },
      {
        key: 'formSettings',
        label: 'Form Settings',
        type: 'text',
        required: false,
        helpText:
          'Optional JSON object of form settings on top of the baseline’s, like `{ "showBranding": false, "notifyOnSubmission": true }`. Fields are named by key, and email copy may use `{{key}}`.',
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
