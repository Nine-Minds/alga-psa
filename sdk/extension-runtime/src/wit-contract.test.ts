import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const templateWitPath = resolve(
  process.cwd(),
  '../alga-client-sdk/templates/component-basic/wit/extension-runner.wit',
)
const runnerWitPath = resolve(
  process.cwd(),
  '../../ee/runner/wit/extension-runner.wit',
)

describe('extension runner WIT contract', () => {
  it('defines clients list/get imports with typed records', () => {
    const wit = readFileSync(templateWitPath, 'utf8')

    expect(wit).toContain('interface clients')
    expect(wit).toContain('record clients-list-input')
    expect(wit).toContain('record clients-list-result')
    expect(wit).toContain('record client-summary')
    expect(wit).toContain('list-clients: func(input: clients-list-input) -> result<clients-list-result, client-read-error>')
    expect(wit).toContain('get-client: func(client-id: string) -> result<option<client-summary>, client-read-error>')
  })

  it('defines services list/get imports with typed records', () => {
    const wit = readFileSync(templateWitPath, 'utf8')

    expect(wit).toContain('interface services')
    expect(wit).toContain('record services-list-input')
    expect(wit).toContain('record services-list-result')
    expect(wit).toContain('record service-summary')
    expect(wit).toContain('list-services: func(input: services-list-input) -> result<services-list-result, service-read-error>')
    expect(wit).toContain('get-service: func(service-id: string) -> result<option<service-summary>, service-read-error>')
  })

  it('keeps template WIT in sync with runner WIT for client/service read imports', () => {
    const templateWit = readFileSync(templateWitPath, 'utf8')
    const runnerWit = readFileSync(runnerWitPath, 'utf8')

    expect(templateWit).toContain('list-clients: func(input: clients-list-input) -> result<clients-list-result, client-read-error>')
    expect(runnerWit).toContain('list-clients: func(input: clients-list-input) -> result<clients-list-result, client-read-error>')
    expect(templateWit).toContain('get-client: func(client-id: string) -> result<option<client-summary>, client-read-error>')
    expect(runnerWit).toContain('get-client: func(client-id: string) -> result<option<client-summary>, client-read-error>')

    expect(templateWit).toContain('list-services: func(input: services-list-input) -> result<services-list-result, service-read-error>')
    expect(runnerWit).toContain('list-services: func(input: services-list-input) -> result<services-list-result, service-read-error>')
    expect(templateWit).toContain('get-service: func(service-id: string) -> result<option<service-summary>, service-read-error>')
    expect(runnerWit).toContain('get-service: func(service-id: string) -> result<option<service-summary>, service-read-error>')
  })
})
