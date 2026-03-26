import { callProxyJson } from '../../../../extension-runtime/src/index.ts'

export async function fetchSummaryViaUiProxy(uiProxy: any) {
  return callProxyJson(uiProxy, '/api/ui-proxy/summary')
}
