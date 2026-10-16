'use strict'

const { formstepRpc } = require('../utils/request')
const { withIsoTimes } = require('../utils/request_summary')
const { listFields, ZAPIER_TYPE_BY_FIELD_TYPE } = require('../utils/fields')
const { uploadDocuments } = require('../utils/documents')
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

// Option-valued types whose answer is one option key …
const SINGLE_CHOICE_TYPES = new Set(['radio', 'select'])
// … or a list of option keys.
const MULTI_CHOICE_TYPES = new Set(['checkbox', 'ranking', 'picture-choice'])

/**
 * The Zapier input key for one field key. A field key may contain `.` and `-`
 * (Formstep allows `[A-Za-z0-9_.-]`), which a Zapier key may not, so those
 * become `_`. The payload is rebuilt by walking `fields.list` again rather than
 * by decoding, so the encoding does not need to be reversible; it only needs
 * to be unique within one form, which inputKeys checks.
 */
function inputKeyFor(prefix, ...keys) {
  return [prefix, ...keys.map((key) => key.replace(/[^A-Za-z0-9_]/g, '_'))].join('__')
}

function optionChoices(item) {
  return Object.fromEntries(item.options.map((option) => [option.key, option.label]))
}

/** The input for one plain (non-group, non-matrix) field, or a group member. */
function plainInput(item, key, label) {
  const base = { key, label, required: false, helpText: `Field key: ${item.key}` }
  if (SINGLE_CHOICE_TYPES.has(item.type)) return { ...base, type: 'string', choices: optionChoices(item) }
  if (MULTI_CHOICE_TYPES.has(item.type)) return { ...base, type: 'string', list: true, choices: optionChoices(item) }
  if (item.type === 'date') return { ...base, type: 'datetime', helpText: `${base.helpText}. Only the date part is sent.` }
  const type = ZAPIER_TYPE_BY_FIELD_TYPE[item.type] || 'string'
  return { ...base, type }
}

/**
 * The per-field inputs of one published form: one input per prefillable field
 * for `prefill`, one per hidden field for `context`, and a multi-select of
 * prefilled keys for `readonly`. Files, signatures, payments, appointments and
 * calculated fields are not prefillable and get no input.
 */
function fieldInputs(items) {
  const prefillChoices = {}
  const inputs = []
  for (const item of items) {
    if (item.context) {
      inputs.push({
        key: inputKeyFor('context', item.key),
        label: `${item.title} (context)`,
        type: 'string',
        required: false,
        helpText: `Hidden field ${item.key}: the recipient cannot change it and sees it only where the form mentions it. It comes back in the request's Context and among the answers.`,
      })
      continue
    }
    if (Array.isArray(item.members)) {
      const members = item.members.filter((member) => member.prefillable && !Array.isArray(member.rows))
      if (members.length === 0) continue
      inputs.push({
        key: inputKeyFor('prefill', item.key),
        label: item.key,
        required: false,
        helpText: `Repeating group ${item.key}: one line item per instance.`,
        children: members.map((member) => plainInput(member, inputKeyFor('prefill', item.key, member.key), member.title)),
      })
      prefillChoices[item.key] = item.key
      continue
    }
    if (!item.prefillable) continue
    if (Array.isArray(item.rows)) {
      const columns = Object.fromEntries(item.columns.map((column) => [column.key, column.label]))
      for (const row of item.rows) {
        inputs.push({
          key: inputKeyFor('prefill', item.key, row.key),
          label: `${item.title} › ${row.label}`,
          type: 'string',
          required: false,
          choices: columns,
          helpText: `Field key: ${item.key}, row ${row.key}`,
        })
      }
      prefillChoices[item.key] = item.title
      continue
    }
    inputs.push(plainInput(item, inputKeyFor('prefill', item.key), item.title))
    prefillChoices[item.key] = item.title
  }

  if (Object.keys(prefillChoices).length > 0) {
    inputs.push({
      key: 'readonly',
      label: 'Read-only fields',
      type: 'string',
      list: true,
      required: false,
      choices: prefillChoices,
      helpText: 'Prefilled fields the recipient may see but not change. Each one must also be prefilled above.',
    })
  }
  return inputs
}

/**
 * The Documents inputs, for a form with a Documents block: files the
 * recipient finds in that block, below the ones the form already has. A form
 * with several blocks also asks which one they go into.
 */
function documentInputs(items) {
  const blocks = items.filter((item) => item.type === 'documents')
  if (blocks.length === 0) return []
  const files = {
    key: 'documents',
    label: 'Documents',
    type: 'file',
    list: true,
    required: false,
    helpText:
      'Files the recipient can open and download in the form, such as a contract or a price list. PDF or image, up to 25 MB each, shown under their own file names.',
  }
  if (blocks.length === 1) return [files]
  return [
    files,
    {
      key: 'documentsBlock',
      label: 'Documents Block',
      type: 'string',
      required: false,
      choices: Object.fromEntries(blocks.map((block) => [block.key, block.title || block.key])),
      helpText: 'This form has several Documents blocks; pick the one the files go into. Needed when you attach documents.',
    },
  ]
}

async function getFieldInputs(z, bundle) {
  const formId = bundle.inputData.formId
  if (!formId) return []
  const items = await listFields(z, bundle, formId)
  const inputs = [...fieldInputs(items), ...documentInputs(items)]
  const keys = inputs.flatMap((input) => [input.key, ...(input.children || []).map((child) => child.key)])
  const duplicate = keys.find((key, index) => keys.indexOf(key) !== index)
  if (duplicate) {
    throw new Error(`Two field keys of this form map to the same input (${duplicate}). Rename one of them in the editor.`)
  }
  return inputs
}

// ─── payload ────────────────────────────────────────────────────────────────

/** Zapier hands a mapped value as a string; the API wants the shape fields.list names. */
function coerce(item, value) {
  if (item.type === 'date') return String(value).slice(0, 10)
  if (ZAPIER_TYPE_BY_FIELD_TYPE[item.type] === 'number') return typeof value === 'string' ? Number(value) : value
  if (item.type === 'switch') {
    if (value === 'true') return true
    if (value === 'false') return false
    return value
  }
  if (MULTI_CHOICE_TYPES.has(item.type)) return (Array.isArray(value) ? value : [value]).filter((entry) => !isBlank(entry))
  return value
}

function plainValue(item, value) {
  if (isBlank(value)) return undefined
  const coerced = coerce(item, value)
  if (Array.isArray(coerced) && coerced.length === 0) return undefined
  return coerced
}

/** The `prefill` and `context` maps, from the inputs fieldInputs offered for these items. */
function buildFieldValues(items, inputData) {
  const prefill = {}
  const context = {}
  for (const item of items) {
    if (item.context) {
      const value = inputData[inputKeyFor('context', item.key)]
      if (!isBlank(value)) context[item.key] = value
      continue
    }
    if (Array.isArray(item.members)) {
      const rows = inputData[inputKeyFor('prefill', item.key)]
      if (!Array.isArray(rows)) continue
      const instances = rows
        .map((row) => {
          const instance = {}
          for (const member of item.members) {
            const value = plainValue(member, row[inputKeyFor('prefill', item.key, member.key)])
            if (value !== undefined) instance[member.key] = value
          }
          return instance
        })
        .filter((instance) => Object.keys(instance).length > 0)
      if (instances.length > 0) prefill[item.key] = instances
      continue
    }
    if (Array.isArray(item.rows)) {
      const matrix = {}
      for (const row of item.rows) {
        const value = inputData[inputKeyFor('prefill', item.key, row.key)]
        if (!isBlank(value)) matrix[row.key] = value
      }
      if (Object.keys(matrix).length > 0) prefill[item.key] = matrix
      continue
    }
    const value = plainValue(item, inputData[inputKeyFor('prefill', item.key)])
    if (value !== undefined) prefill[item.key] = value
  }
  return { prefill, context }
}

/**
 * The Documents block the files of this run go into: none named when the form
 * has one block, which Formstep then picks, and the picked one when it has
 * several. Checked before any upload, so a run Formstep would refuse leaves
 * no document behind.
 */
function documentsBlockFor(items, input) {
  const blocks = items.filter((item) => item.type === 'documents')
  if (blocks.length === 0) throw new Error('This form has no Documents block, so it cannot take documents. Add one in the editor, or leave Documents empty.')
  if (blocks.length === 1) return undefined
  if (isBlank(input.documentsBlock)) throw new Error('This form has several Documents blocks. Pick the one the documents go into under Documents Block.')
  return input.documentsBlock
}

/** The `requests.create` params for one run: the picked form, its field values, documents and the shared request options. */
async function buildCreateParams(z, bundle) {
  const input = bundle.inputData
  const items = await listFields(z, bundle, input.formId)
  const { prefill, context } = buildFieldValues(items, input)
  const readonly = nonBlankList(input.readonly)
  const options = requestOptionParams(input)
  // Last, so a mistake in any other input never leaves an uploaded document behind.
  const files = nonBlankList(input.documents)
  const documents = files.length > 0 ? await uploadDocuments(z, bundle, input.formId, files, documentsBlockFor(items, input)) : []

  return {
    formId: input.formId,
    ...options,
    ...(Object.keys(context).length > 0 ? { context } : {}),
    ...(Object.keys(prefill).length > 0 ? { prefill } : {}),
    ...(readonly.length > 0 ? { readonly } : {}),
    ...(documents.length > 0 ? { documents } : {}),
  }
}

async function perform(z, bundle) {
  const params = await buildCreateParams(z, bundle)
  return withIsoTimes(await formstepRpc({ z, bundle, method: 'requests.create', params }))
}

const create = {
  key: 'create_request',
  noun: 'Request',
  display: {
    label: 'Create Request',
    description: 'Creates a request: assigns a published form to one recipient and returns the link to complete it. To build the form in the same step, use Create Request With New Form.',
  },
  operation: {
    cleanInputData: false,
    inputFields: [
      {
        key: 'formId',
        label: 'Form',
        type: 'string',
        required: true,
        dynamic: 'form_list.id.label',
        altersDynamicFields: true,
        helpText: 'The published form the recipient will complete. Its field keys appear below once it is chosen.',
      },
      ...recipientInputs,
      languageInput,
      ...requestOptionInputs,
      getFieldInputs,
    ],
    perform,
    sample: requestSample,
    outputFields: requestOutputFields,
  },
}

module.exports = create
