// BASE_URL is read at module load in utils/request, so set it before requiring.
process.env.BASE_URL = 'https://fake.formstep.test'

const nock = require('nock')
const { formstepRpc } = require('../utils/request')
const { makeZ, RefreshAuthError, ThrottledError } = require('./helpers')

const FAKE_BASE = process.env.BASE_URL
const bundle = { authData: { access_token: 'fbo_access' } }

describe('formstepRpc', () => {
  afterEach(() => nock.cleanAll())

  test('posts to /api/v1 with the OAuth bearer token and returns data on ok', async () => {
    nock(FAKE_BASE)
      .post('/api/v1', { method: 'me.get', params: {} })
      .matchHeader('authorization', 'Bearer fbo_access')
      .matchHeader('content-type', 'application/json')
      .reply(200, { ok: true, data: { id: 'u1', email: 'a@b.com' } })

    const result = await formstepRpc({ z: makeZ(), bundle, method: 'me.get' })
    expect(result).toEqual({ id: 'u1', email: 'a@b.com' })
  })

  test('defaults to https://api.formstep.io when BASE_URL is unset', async () => {
    const saved = process.env.BASE_URL
    delete process.env.BASE_URL
    let freshRpc
    jest.isolateModules(() => {
      freshRpc = require('../utils/request').formstepRpc
    })
    process.env.BASE_URL = saved

    nock('https://api.formstep.io').post('/api/v1').reply(200, { ok: true, data: { items: [] } })

    await expect(freshRpc({ z: makeZ(), bundle, method: 'forms.list' })).resolves.toEqual({ items: [] })
  })

  test('UNAUTHORIZED maps to RefreshAuthError', async () => {
    nock(FAKE_BASE).post('/api/v1').reply(401, { ok: false, error: { code: 'UNAUTHORIZED', message: 'bad token' } })

    await expect(formstepRpc({ z: makeZ(), bundle, method: 'me.get' })).rejects.toBeInstanceOf(RefreshAuthError)
  })

  test('RATE_LIMITED maps to ThrottledError', async () => {
    nock(FAKE_BASE).post('/api/v1').reply(429, { ok: false, error: { code: 'RATE_LIMITED', message: 'slow down' } })

    await expect(formstepRpc({ z: makeZ(), bundle, method: 'me.get' })).rejects.toBeInstanceOf(ThrottledError)
  })

  test('other API errors throw an Error carrying the Formstep code', async () => {
    nock(FAKE_BASE).post('/api/v1').reply(400, { ok: false, error: { code: 'VALIDATION_ERROR', message: 'bad params' } })

    await expect(formstepRpc({ z: makeZ(), bundle, method: 'me.get' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'VALIDATION_ERROR: bad params',
    })
  })

  test('a non-JSON failure names the HTTP status instead of pretending to succeed', async () => {
    nock(FAKE_BASE).post('/api/v1').reply(502, '<html>bad gateway</html>')

    await expect(formstepRpc({ z: makeZ(), bundle, method: 'me.get' })).rejects.toMatchObject({ code: 'HTTP_502' })
  })
})
