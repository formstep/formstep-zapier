# Formstep for Zapier

The [Formstep app on Zapier](https://zapier.com/apps/formstep/integrations). Formstep collects and verifies information from customers for workflows and AI agents: a Zap creates a request, the customer completes a branded form without an account, and the verified answers come back keyed by field key. This app creates, finds, reminds and cancels requests, and starts Zaps when a request is completed, expires or is canceled, or when a form is submitted through its public link.

Step-by-step guides with screenshots: [Connect Formstep to Zapier](https://docs.formstep.io/guides/zapier/connect/), [Send a request from a Zap](https://docs.formstep.io/guides/zapier/send-a-request/), [Act on a request's outcome](https://docs.formstep.io/guides/zapier/request-outcome/), [Look up, remind and cancel requests](https://docs.formstep.io/guides/zapier/manage-requests/) and [Send public link submissions to another app](https://docs.formstep.io/guides/zapier/public-link-submissions/).

## What a Zap can do

| Kind    | Name                             | What it does                                                                                                     |
| ------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Trigger | Request Completed                | A recipient completed a request. Answers per field key, the outcome, the submission and its PDF.                 |
| Trigger | Request Expired                  | A request reached its expiry unanswered.                                                                         |
| Trigger | Request Canceled                 | A request was canceled, with the reason.                                                                         |
| Trigger | Public Link Submission Created   | A respondent submitted the form through its public link.                                                         |
| Trigger | Public Link Submission Updated   | A respondent edited a public-link submission they already sent. The form must allow editing after submit.        |
| Trigger | Public Link Submission Abandoned | A public-link draft sat idle for 12 hours, 1 day, 3 days or 1 week. Needs partial-submission tracking.           |
| Action  | Create Request                   | Assign a published form to one recipient, with prefilled, read-only and context fields and documents. Returns the link. |
| Action  | Create Request With New Form     | Build a form from JSON blocks, publish it and assign it to one recipient in one step. Returns the link and the new form's field keys. |
| Action  | Get Request                      | Read a request, with its answers once it is completed.                                                           |
| Action  | Remind Request                   | Email the recipient a reminder now.                                                                              |
| Action  | Cancel Request                   | Withdraw a pending request, with an optional reason.                                                             |
| Search  | Find Request                     | Find requests by the External ID a Create Request step gave them.                                                |

## Good to know

- **Form** dropdowns list the connected workspace's forms; one that is not published yet says so. Create Request loads one input per field of the picked form, labelled with the question, and a multi-select of the prefilled fields to lock.
- **Documents** on Create Request take files from earlier steps (an attachment, a Drive or Dropbox file); the recipient opens them in the form. PDFs and images, up to 25 MB each.
- **Create Request With New Form** sends the form's blocks as JSON, and Formstep builds, publishes and sends it in one call. The same definition again reuses the form, so put per-recipient values in **Prefill** and **Context**, never in the name or a block. Blocks: [Create a form and a request in one call](https://docs.formstep.io/requests/inline-forms/).
- **External ID** is also the idempotency key: a replayed Zap run gets the same request back (`deduplicated: true`) instead of a second link.
- **Test Request** sends nothing and starts no Zap: request triggers fire for real requests only.
- Every event fires one trigger: a completed request fires **Request Completed** alone, never Public Link Submission Created.
- Request actions return times as ISO 8601. A failed call stops the step with the Formstep code, message and cause, such as `VALIDATION_ERROR: No prefillable field with key "nope" on this form. (Reason: UNKNOWN_FIELD_KEY. Field: nope. Valid keys: full_name, company_name)`. A rate limit makes Zapier wait as long as Formstep asks and retry.

## How it works

This repository is a self-contained CommonJS project with its own `node_modules`
and `package-lock.json`, as required by the Zapier CLI.

- **Auth** (`authentication.js`) — OAuth 2.0 authorization code + **PKCE (S256,
  mandatory)**. Users click Connect, sign in, pick a workspace on the consent
  screen, approve — no API token to paste. Backed by
  `packages/convex/src/http/oauthServer/`.
  - Scope `api:read api:write offline_access` (`offline_access` → rotating
    refresh token; access 1h, refresh 30d).
  - `test` calls `me.get` (`{ id, email, name }`) so the label renders `{{email}}`.
  - Env vars: `CLIENT_ID`, `CLIENT_SECRET` (see setup below), optional `BASE_URL`
    (default `https://api.formstep.io`).
- **Triggers** — six REST hooks built by one factory, `utils/hook_trigger.js`.
  Each picks a form, subscribes with one `webhooks.create` `eventType`,
  unsubscribes with `webhooks.delete`, and accepts exactly one event `type`; a
  delivery of any other type is rejected, so a misrouted event never runs the
  wrong Zap. `utils/request_trigger.js` and
  `utils/public_link_submission_trigger.js` hold what differs: the event, the
  labels, the sample, and the idle window of the abandoned trigger.

  | Trigger key                        | `eventType`            | Delivered `type`       | Test sample                     |
  | ---------------------------------- | ---------------------- | ---------------------- | ------------------------------- |
  | `request_completed`                | `request_completed`    | `request.completed`    | `requests.sample`               |
  | `request_expired`                  | `request_expired`      | `request.expired`      | `requests.sample`               |
  | `request_canceled`                 | `request_canceled`     | `request.canceled`     | `requests.sample`               |
  | `public_link_submission_created`   | `submission_created`   | `submission.completed` | `submissions.sample`            |
  | `public_link_submission_updated`   | `submission_updated`   | `submission.updated`   | `submissions.sample`, relabeled |
  | `public_link_submission_abandoned` | `submission_abandoned` | `submission.abandoned` | `submissions.sample`, relabeled |

  - Every event is the Formstep envelope `{ id, type, createdAt, apiVersion,
    test, data }`. `data.answers` holds each answer once under its field key,
    `data.display` the readable text under the same key, and `data.submission`
    the email, timestamps, edit count, PDF link and language. A request event
    adds `data.request`; an expired or canceled request carries that block
    alone.
  - Output fields are built per form from `fields.list`
    (`data__answers__<key>` and `data__display__<key>`, labelled with the
    question title). A repeating group's members are line items under the
    group key, a matrix gets one field per row, and a booking or a payment one
    field per property. A form that is not published yet lists the envelope
    alone, so a Zap can be wired up before publishing.
  - The PDF File output hydrates from `submissions.pdf` when the event carries
    `data.submission.pdfUrl`; an event that carries a PDF without the ids to
    hydrate it fails loudly instead of dropping the output.
- **Webhook verification** (`utils/webhooks.js`) — each subscription generates
  a unique signing secret, passes it to `webhooks.create`, stores it in
  Zapier's `subscribeData`, and verifies `X-Formstep-Signature` against the
  exact raw request body with HMAC-SHA256. Requests with a missing or invalid
  signature, or a timestamp more than five minutes old, are rejected.
- **Create Request** (`creates/create_request.js`, `requests.create`) — the
  per-field inputs come from `fields.list` (`prefill` for visible questions,
  `context` for hidden fields, `readonly` for the prefilled keys to lock).
  Zapier input keys cannot hold `.` or `-`, so field keys are encoded to `_`
  in the editor and the payload is rebuilt from the live field list on every
  run; two keys that encode the same fail loudly. The output is the created
  summary with the share link under `url`.
- **Create Request With New Form** (`creates/create_request_with_new_form.js`,
  `requests.create` with `form` instead of `formId`) — `formName`,
  `formBlocks` (a JSON array), the optional `formLanguage` and `formEmoji`,
  and the optional `formLogo`, `formCover`, `formTheme`, `formSettings` and
  `formTranslations` (JSON objects) make up the `form` object; `prefill` and `context` are JSON objects keyed by block key,
  `readonly` a list of keys. JSON inputs are parsed and shape-checked before
  any call, naming the input that fails. The form does not exist before the
  call, so there are no per-field inputs and no Documents input
  (`documents.create` needs a form id). The output adds the `form` summary:
  `id`, `name`, `reused`, `fields` and, when Formstep made a new form next to
  one with the same questions, `similarForm`. The recipient, delivery,
  reminder, expiry, External ID, metadata and test inputs are the ones Create
  Request uses, from `utils/request_inputs.js`.
- **Documents** (`utils/documents.js`) — a form with a Documents block gets a
  `documents` file list, plus a `documentsBlock` dropdown when it has several.
  Zapier hands each file over as a URL. After every other input has been
  checked, each file is downloaded, reserved with `documents.create` (size and
  sha256 declared) and PUT to the presigned URL it answers with, in parallel,
  and `requests.create` references the ids in the order the files were given.
  The name comes from the download's `Content-Disposition`, else the URL,
  else `Document N.<ext>`; the type from the file's first bytes, else the
  response, else the name. The PUT carries no Formstep token: the presigned
  URL is its own credential.
  - A replayed Zap uploads its files again under new document ids. Formstep
    counts a document by its bytes, block and name for the idempotency check,
    so the replay with the same External ID still gets the original request
    back. That needs a Formstep backend with that rule (Formstep commit
    "let a retry that uploads the same document again deduplicate"); an older
    one refuses the replay with `IDEMPOTENCY_CONFLICT`.
- **Get, Remind, Cancel** (`creates/`) and **Find Request**
  (`searches/find_request.js`, `requests.list` by external id, within a form
  or across the workspace) share the request summary outputs in
  `utils/request_summary.js`. Formstep returns a request's timestamps in Unix
  milliseconds; `withIsoTimes` turns every `…At` time and the timeline into
  ISO 8601, the shape events already carry.
- **Dropdowns** (`utils/dropdowns.js`) — hidden triggers `form_list`
  (`form_list.id.label`, every page of `forms.list`) and `request_list`
  (`request_list.id.label`, `requests.list` one page per dropdown page, the
  Formstep cursor kept in `z.cursor`). An OAuth token is scoped to one
  workspace, so both list that workspace.
- **JSON-RPC client** (`utils/request.js`) — POSTs to `${BASE_URL}/api/v1` with
  `Authorization: Bearer <access_token>` and unwraps the `{ ok, data, error }`
  envelope. `UNAUTHORIZED` → `RefreshAuthError` (token refresh + retry),
  `RATE_LIMITED` → `ThrottledError` with Formstep's `retryAfterMs` as the
  delay, anything else → `Error("CODE: message (Reason: …. Field: …)")` with
  `error.code` set. There is no `beforeRequest` middleware: the client sets
  its own header, and a middleware would also run on the OAuth token and
  refresh requests.

### Auth-config gotchas (don't regress these)

Zapier injects standard OAuth fields itself; declaring them manually breaks the
flow:

- **`authorizeUrl.params`** declares **only `scope`**. Zapier auto-appends
  `client_id`, `state`, `redirect_uri`, `response_type`, `code_challenge`,
  `code_challenge_method`. Declaring `client_id` lands it first as an empty value
  and shadows Zapier's → `Missing required parameter: client_id`.
- **`getAccessToken.body` lists every field, including `code_verifier`.** Unlike
  `authorizeUrl`, Zapier does **not** merge into the token body — it sends exactly
  what we define. Omit `grant_type` → `grant_type <missing>`; omit `code_verifier`
  → `code, redirect_uri, and code_verifier are required`. `enablePkce` exposes the
  verifier as `{{bundle.inputData.code_verifier}}`; client creds go in the body
  (`client_secret_post`).
- `refreshAccessToken` keeps its own explicit body (refresh needs no PKCE).

## OAuth client setup (`oauthClients` table)

Zapier needs a **fixed** `client_id`/`secret` baked into its env, so it uses a
first-party **system client** seeded directly into the `oauthClients` table — not
public Dynamic Client Registration (DCR ids are random per env and the
orphan-client GC reaps them after 30d once token-less).

`internal/oauthClients.ts:seedZapierOAuthClient` inserts a row with `createdByIp`
unset (→ GC-protected) and `tokenEndpointAuthMethod: 'client_secret_post'`. The
secret is read from the `ZAPIER_OAUTH_CLIENT_SECRET` Convex env var (never a CLI
arg) and stored hashed; you set the **same** plaintext on Zapier.

The `redirectUris` must exactly match the Zapier callback shown in the dashboard
(**Settings → Authentication**) — currently
`https://zapier.com/dashboard/auth/oauth/return/App242862CLIAPI/`. A mismatch →
`redirect_uri not registered for this client`. Verify the app id before seeding.

```bash
# Run against BOTH prod and dev (same secret) so the Zap works in both.
# 1. Set the secret on the Formstep deployment (add --prod for production).
npx convex env set ZAPIER_OAUTH_CLIENT_SECRET 'pick_a_long_random_secret'

# 2. Seed the client — idempotent; re-run to update redirectUris / rotate secret.
npx convex run internal/oauthClients:seedZapierOAuthClient \
  '{"redirectUris":["https://zapier.com/dashboard/auth/oauth/return/App242862CLIAPI/"]}'
# → { "clientId": "fboc_zapier", "created": true }

# 3. Mirror onto the Zapier app version (injected as process.env.*). Secret MUST
#    equal step 1's value.
npx zapier-platform env:set <version> \
  CLIENT_ID=fboc_zapier \
  CLIENT_SECRET='pick_a_long_random_secret'
```

Leave `BASE_URL` unset: the app defaults to `https://api.formstep.io`, and a
value set here overrides that default.

`client_id` defaults to `fboc_zapier` (override with a `clientId` arg). This is a
separate row from public DCR clients (e.g. Claude MCP), so it never interferes
with them — the server authenticates each client by its stored auth method.

## Develop, validate, publish

```bash
cd formstep-zapier
npm ci
npm test                          # jest: unit tests (nock) + a lifecycle test against an in-process Formstep API
npm run validate                  # Zapier's structural schema check, offline (CI runs it too)

npx zapier-platform login --sso   # one-time
npx zapier-platform validate      # adds Zapier's online integration checks
```

Release a version:

1. Bump `version` in `package.json` and `package-lock.json` and add a `CHANGELOG.md` entry.
2. `npx zapier-platform push`. The new version is private until promoted, and copies `CLIENT_ID` and `CLIENT_SECRET` from the promoted one; check with `npx zapier-platform env:get <version>` (without printing the secret anywhere shared) that both are set and `BASE_URL` is not.
3. Smoke it before users get it. `npx zapier-platform invoke <create|search|trigger> <key> -r -v <version> -a <connection id> -i '<json>'` runs an action on Zapier's servers with a real connection (list the ids with `-a -` in a terminal). For a trigger, build a Zap on the new version in the editor, publish it, fire the event, check Zap history, and turn it off.
4. `npx zapier-platform promote <version>`, then `npx zapier-platform migrate <old> <new>` to move existing Zaps. Subscriptions and signing secrets survive a migration, so no Zap is turned off and on.

Renaming or removing a trigger key that a live Zap uses fails the push with "Found live Zaps using deleted trigger"; keep keys stable.

> CLI bin is `zapier-platform` (was `zapier`) since `zapier-platform-cli` v19.
> `validate` needs the app registered first (expects `.zapierapprc`).

The app is public in beta in the Zapier App Directory. Zapier's integration checks still list T003 (a trigger with no recent live Zap task) and D004 (External ID looks like an ID without a dropdown; it is the caller's own key, so it takes no dropdown) as warnings that do not block.

## Reference

- [Formstep API methods](https://docs.formstep.io/developers/rest-api)
- [Formstep webhook reference](https://docs.formstep.io/developers/webhooks-reference)

## File map

```
formstep-zapier/
├── authentication.js        # OAuth 2.0 (auth code + PKCE)
├── hydrators.js             # lazy PDF File download via submissions.pdf
├── index.js                 # app export
├── triggers/
│   ├── request_completed.js / request_expired.js / request_canceled.js
│   ├── public_link_submission_created.js / _updated.js / _abandoned.js
│   ├── form_list.js         # hidden: Form dropdown
│   └── request_list.js      # hidden: Request dropdown
├── creates/
│   ├── create_request.js    # requests.create with per-field prefill/context inputs
│   ├── create_request_with_new_form.js  # requests.create with an inline form definition
│   ├── get_request.js       # requests.get
│   ├── remind_request.js    # requests.remind
│   └── cancel_request.js    # requests.cancel
├── searches/
│   └── find_request.js      # requests.list by external id
├── utils/
│   ├── hook_trigger.js      # the one REST hook trigger factory
│   ├── request_trigger.js   # request events: event types, samples
│   ├── public_link_submission_trigger.js  # submission events: event types, samples, idle window
│   ├── samples.js           # sample envelope, submission, booking and payment
│   ├── events.js            # envelope output fields, PDF hydrator
│   ├── fields.js            # fields.list, per-key output fields, field type map
│   ├── webhooks.js          # subscribe, unsubscribe, signature verification
│   ├── dropdowns.js         # workspace lookup, form and request dropdown sources
│   ├── documents.js         # download, reserve and upload Create Request documents
│   ├── request_summary.js   # request output fields, sample, Request input
│   ├── request_inputs.js    # recipient, delivery and other inputs both Create Request actions share
│   └── request.js           # JSON-RPC transport + error mapping
└── test/
    ├── helpers.js           # z stand-in, signed-delivery bundle
    ├── fake-formstep.js     # in-process Formstep API for the lifecycle test
    ├── *.test.js            # unit tests (nock)
    └── lifecycle.integration.test.js
```
