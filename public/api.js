const API_BASE = '/api/v1'
const TOKEN_KEY = 'smartRifasToken'

function getToken() {
  return localStorage.getItem(TOKEN_KEY)
}

function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token)
}

function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

function isAuthenticated() {
  return Boolean(getToken())
}

async function request(path, options = {}) {
  const headers = {
    Accept: 'application/json',
    ...options.headers,
  }

  if (options.body !== undefined && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json'
  }

  const token = getToken()
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    body:
      options.body !== undefined && typeof options.body !== 'string'
        ? JSON.stringify(options.body)
        : options.body,
  })

  let data = null
  const contentType = response.headers.get('content-type') || ''

  if (contentType.includes('application/json')) {
    data = await response.json()
  }

  if (!response.ok) {
    const message = data?.error?.message || `Erro ${response.status}`
    const error = new Error(message)
    error.status = response.status
    error.code = data?.error?.code
    error.fields = data?.error?.fields
    throw error
  }

  return data
}

const api = {
  getToken,
  setToken,
  clearToken,
  isAuthenticated,

  auth: {
    async register(payload) {
      const result = await request('/auth/register', { method: 'POST', body: payload })
      if (result.token) setToken(result.token)
      return result
    },

    async login(payload) {
      const result = await request('/auth/login', { method: 'POST', body: payload })
      if (result.token) setToken(result.token)
      return result
    },

    logout() {
      clearToken()
    },
  },

  users: {
    me() {
      return request('/users/me')
    },

    updatePixKey(pixKey) {
      return request('/users/me/pix-key', {
        method: 'PATCH',
        body: { pixKey },
      })
    },
  },

  raffles: {
    list(params = {}) {
      const query = new URLSearchParams()
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          query.set(key, String(value))
        }
      })
      const suffix = query.toString() ? `?${query.toString()}` : ''
      return request(`/raffles${suffix}`)
    },

    getById(id) {
      return request(`/raffles/${id}`)
    },

    create(payload) {
      return request('/raffles', { method: 'POST', body: payload })
    },

    publish(id) {
      return request(`/raffles/${id}/publish`, { method: 'POST' })
    },

    getTickets(id, params = {}) {
      const query = new URLSearchParams()
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          query.set(key, String(value))
        }
      })
      const suffix = query.toString() ? `?${query.toString()}` : ''
      return request(`/raffles/${id}/tickets${suffix}`)
    },

    getAvailableNumbers(id, params = {}) {
      const query = new URLSearchParams()
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          query.set(key, String(value))
        }
      })
      const suffix = query.toString() ? `?${query.toString()}` : ''
      return request(`/raffles/${id}/available-numbers${suffix}`)
    },
  },

  tickets: {
    my() {
      return request('/tickets/my')
    },

    reserve(raffleId, payload) {
      return request(`/raffles/${raffleId}/tickets`, {
        method: 'POST',
        body: payload,
      })
    },
  },

  payments: {
    createCheckoutSession(ticketId) {
      return request(`/payments/tickets/${ticketId}/checkout-session`, { method: 'POST' })
    },

    status(ticketId) {
      return request(`/payments/tickets/${ticketId}/status`)
    },
  },

  draws: {
    execute(raffleId) {
      return request(`/raffles/${raffleId}/draw`, { method: 'POST' })
    },

    result(raffleId) {
      return request(`/raffles/${raffleId}/draw`)
    },
  },
}

window.api = api
