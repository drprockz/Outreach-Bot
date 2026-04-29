import { createClient, fetchExchange, subscriptionExchange, type Client } from '@urql/core'
import { createClient as createWSClient, type Client as WSClient } from 'graphql-ws'

// Same-origin by default so the vite dev proxy can route /graphql to the new
// API on :3002. WS needs an absolute host, so derive it from window.location
// when API_URL is relative.
const API_URL = import.meta.env.VITE_API_URL ?? ''
const WS_URL = API_URL
  ? API_URL.replace(/^http/, 'ws')
  : `${typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss' : 'ws'}://${typeof window !== 'undefined' ? window.location.host : 'localhost'}`

let wsClient: WSClient | null = null

function getWsClient(): WSClient {
  if (wsClient) return wsClient
  wsClient = createWSClient({
    url: `${WS_URL}/graphql`,
    connectionParams: async () => {
      // The HttpOnly cookie can't be read by JS — fetch the token through /auth/google/token
      const res = await fetch(`${API_URL}/auth/google/token`, { credentials: 'include' })
      if (!res.ok) return {}
      const { token } = (await res.json()) as { token?: string }
      return token ? { authToken: token } : {}
    },
    lazy: true,
  })
  return wsClient
}

export const urqlClient: Client = createClient({
  url: `${API_URL}/graphql`,
  fetchOptions: { credentials: 'include' },
  exchanges: [
    fetchExchange,
    subscriptionExchange({
      forwardSubscription: (request) => ({
        subscribe: (sink) => ({
          unsubscribe: getWsClient().subscribe(
            { ...request, query: request.query ?? '' },
            sink,
          ),
        }),
      }),
    }),
  ],
})
