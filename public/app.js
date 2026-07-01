const state = {
  user: null,
  raffle: null,
  ticketPriceCents: 0,
  soldNumbers: new Set(),
  reservedNumbers: new Set(),
  selectedNumbers: new Set(),
  numberFilter: 'all',
  reservedTickets: [],
  pixPayments: [],
  paymentPollId: null,
  authMode: 'login',
}

const PROTECTED_HASHES = new Set(['#painel'])
const THEME_STORAGE_KEY = 'smart-rifas-theme'

const FALLBACK_RAFFLE = {
  id: null,
  title: 'Campanha demo',
  status: 'OPEN',
  totalTickets: 60,
  ticketPriceCents: 1200,
  drawMethod: 'LOTERIA_FEDERAL',
  drawDate: null,
  createdAt: new Date().toISOString(),
  _count: { tickets: 0 },
}

const grid = document.querySelector('#numberGrid')
const selectedList = document.querySelector('#selectedList')
const totalValue = document.querySelector('#totalValue')
const payButton = document.querySelector('#payButton')
const pixBox = document.querySelector('#pixBox')
const authButton = document.querySelector('#authButton')
const authDialog = document.querySelector('#authDialog')
const authForm = document.querySelector('#authForm')
const authCloseButton = document.querySelector('#authCloseButton')
const toggleAuthMode = document.querySelector('#toggleAuthMode')
const authNameField = document.querySelector('#authNameField')
const authCpfField = document.querySelector('#authCpfField')
const authName = document.querySelector('#authName')
const authCpf = document.querySelector('#authCpf')
const authEmail = document.querySelector('#authEmail')
const authPassword = document.querySelector('#authPassword')
const authError = document.querySelector('#authError')
const authSubmit = document.querySelector('#authSubmit')
const authTitle = document.querySelector('#auth-title')
const authLead = document.querySelector('#authLead')
const authEyebrow = document.querySelector('#authEyebrow')
const authSwitchLabel = document.querySelector('#authSwitchLabel')
const themeToggle = document.querySelector('#themeToggle')
const toast = document.querySelector('#toast')
const pageLoader = document.querySelector('#pageLoader')
const filterButtons = document.querySelectorAll('.segmented-control button')
const statRaised = document.querySelector('#statRaised')
const statSold = document.querySelector('#statSold')
const statPrice = document.querySelector('#statPrice')
const statDrawDate = document.querySelector('#statDrawDate')
const timelinePublished = document.querySelector('#timelinePublished')
const timelineSales = document.querySelector('#timelineSales')
const timelineDrawTitle = document.querySelector('#timelineDrawTitle')
const timelineDraw = document.querySelector('#timelineDraw')
const dashboardBand = document.querySelector('#painel')

function formatNumber(value) {
  return String(value).padStart(3, '0')
}

function getPreferredTheme() {
  const stored = localStorage.getItem(THEME_STORAGE_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme)

  if (!themeToggle) return

  const isDark = theme === 'dark'
  themeToggle.setAttribute('aria-label', isDark ? 'Ativar modo claro' : 'Ativar modo escuro')
  themeToggle.setAttribute('title', isDark ? 'Modo claro' : 'Modo escuro')
}

function toggleTheme() {
  const current =
    document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
  const next = current === 'dark' ? 'light' : 'dark'
  localStorage.setItem(THEME_STORAGE_KEY, next)
  applyTheme(next)
}

function initTheme() {
  applyTheme(getPreferredTheme())
  themeToggle?.addEventListener('click', toggleTheme)
}

function formatCurrencyFromCents(cents) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(cents / 100)
}

function formatDate(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('pt-BR').format(new Date(value))
}

function showToast(message, type = 'info') {
  toast.textContent = message
  toast.dataset.type = type
  toast.hidden = false

  window.clearTimeout(showToast.timeoutId)
  showToast.timeoutId = window.setTimeout(() => {
    toast.hidden = true
  }, 4000)
}

function setLoading(isLoading) {
  pageLoader.hidden = !isLoading
  payButton.disabled = isLoading
  authSubmit.disabled = isLoading
}

async function withLoading(task, successMessage) {
  setLoading(true)
  try {
    const result = await task()
    if (successMessage) showToast(successMessage, 'success')
    return result
  } catch (error) {
    showToast(error.message || 'Erro inesperado', 'error')
    throw error
  } finally {
    setLoading(false)
  }
}

function updateAuthButton() {
  if (state.user) {
    authButton.textContent = `Sair (${state.user.name.split(' ')[0]})`
  } else {
    authButton.textContent = 'Entrar'
  }
}

function setAuthMode(mode) {
  state.authMode = mode
  const isRegister = mode === 'register'

  authNameField.hidden = !isRegister
  authCpfField.hidden = !isRegister
  authSubmit.textContent = isRegister ? 'Criar conta' : 'Entrar'
  toggleAuthMode.textContent = isRegister ? 'Entrar' : 'Criar conta'
  authTitle.textContent = isRegister ? 'Criar sua conta' : 'Entrar na Smart Rifas'
  authEyebrow.textContent = isRegister ? 'Cadastro' : 'Acesso'
  authLead.textContent = isRegister
    ? 'Cadastre-se para comprar cotas, pagar com Stripe Checkout e acompanhar seus números.'
    : 'Entre para reservar números, pagar com Stripe Checkout e acompanhar suas cotas.'
  authSwitchLabel.textContent = isRegister ? 'Já tem conta?' : 'Ainda não tem conta?'
  authError.hidden = true
  authPassword.autocomplete = isRegister ? 'new-password' : 'current-password'
}

function openAuthDialog(mode = 'login') {
  setAuthMode(mode)
  authError.hidden = true
  authDialog.showModal()
}

function closeAuthDialog() {
  authDialog.close()
}

function requireAuth(action) {
  if (api.isAuthenticated()) return true
  openAuthDialog('login')
  showToast('Faca login para continuar', 'error')
  return false
}

function guardProtectedRoute() {
  const hash = window.location.hash || '#rifas'

  if (!PROTECTED_HASHES.has(hash)) return true
  if (api.isAuthenticated()) return true

  openAuthDialog('login')
  showToast('Esta area exige autenticacao', 'error')
  window.location.hash = '#rifas'
  return false
}

async function loadSession() {
  if (!api.isAuthenticated()) {
    state.user = null
    updateAuthButton()
    return
  }

  try {
    state.user = await api.users.me()
    updateAuthButton()
  } catch {
    api.auth.logout()
    state.user = null
    updateAuthButton()
  }
}

async function loadFeaturedRaffle() {
  try {
    const response = await api.raffles.list({ status: 'OPEN', limit: 1 })

    if (response.data?.length) {
      state.raffle = response.data[0]
    } else {
      const fallback = await api.raffles.list({ limit: 1 })
      state.raffle = fallback.data?.[0] || null
    }
  } catch {
    state.raffle = null
  }

  if (!state.raffle) {
    state.raffle = { ...FALLBACK_RAFFLE }
    state.ticketPriceCents = FALLBACK_RAFFLE.ticketPriceCents
    updateStats()
    updateDashboard()
    renderNumberGrid()
    showToast('Nenhuma rifa ativa. Exibindo grade demo com 60 numeros.', 'info')
    return
  }

  state.ticketPriceCents = state.raffle.ticketPriceCents
  await refreshRaffleData()
}

async function refreshRaffleData() {
  if (!state.raffle?.id) {
    updateStats()
    updateDashboard()
    renderNumberGrid()
    return
  }

  let raffle = state.raffle
  let tickets = []

  try {
    ;[raffle, { data: tickets }] = await Promise.all([
      api.raffles.getById(state.raffle.id),
      api.raffles.getTickets(state.raffle.id, { limit: 500 }),
    ])
  } catch (error) {
    showToast(error.message || 'Erro ao atualizar dados da rifa', 'error')
    renderNumberGrid()
    return
  }

  state.raffle = raffle
  state.ticketPriceCents = raffle.ticketPriceCents
  state.soldNumbers = new Set()
  state.reservedNumbers = new Set()

  tickets.forEach(ticket => {
    if (ticket.status === 'PAID') state.soldNumbers.add(ticket.number)
    if (ticket.status === 'RESERVED') state.reservedNumbers.add(ticket.number)
  })

  updateStats()
  updateDashboard()
  renderNumberGrid()
  renderCreatorPanel()
}

function updateStats() {
  const raffle = state.raffle
  if (!raffle) return

  const paidCount = raffle._count?.tickets ?? 0
  const totalTickets = raffle.totalTickets || 1
  const soldPercent = Math.round((paidCount / totalTickets) * 100)
  const raisedCents = paidCount * raffle.ticketPriceCents

  statRaised.textContent = formatCurrencyFromCents(raisedCents)
  statSold.textContent = `${soldPercent}%`
  statPrice.textContent = formatCurrencyFromCents(raffle.ticketPriceCents)
  statDrawDate.textContent = formatDate(raffle.drawDate)
}

function updateDashboard() {
  const raffle = state.raffle
  if (!raffle) return

  const paidCount = raffle._count?.tickets ?? 0
  const totalTickets = raffle.totalTickets || 1
  const soldPercent = Math.round((paidCount / totalTickets) * 100)
  const remaining = Math.max(0, 100 - soldPercent)

  timelinePublished.textContent = `A campanha "${raffle.title}" esta com status ${raffle.status}. Publicada em ${formatDate(raffle.createdAt)}.`
  timelineSales.textContent = `${soldPercent}% das cotas ja foram pagas. Faltam ${remaining}% para esgotar.`
  timelineDrawTitle.textContent = raffle.drawDate
    ? `Sorteio em ${formatDate(raffle.drawDate)}`
    : 'Sorteio a definir'
  timelineDraw.textContent =
    raffle.drawMethod === 'LOTERIA_FEDERAL'
      ? 'Vinculado a Loteria Federal. O ganhador sera exibido apos o sorteio.'
      : 'Sorteio automatico pela plataforma apos esgotar ou encerrar vendas.'
}

function shouldShowNumber(number) {
  const isSold = state.soldNumbers.has(number) || state.reservedNumbers.has(number)
  const isAvailable = !isSold

  if (state.numberFilter === 'sold') return isSold
  if (state.numberFilter === 'available') return isAvailable
  return true
}

function renderSelection() {
  const selected = [...state.selectedNumbers].sort((a, b) => a - b)

  if (selected.length === 0) {
    selectedList.textContent = 'Nenhum numero escolhido'
  } else {
    selectedList.innerHTML = selected
      .map(number => `<span class="number-chip">#${formatNumber(number)}</span>`)
      .join('')
  }

  totalValue.textContent = formatCurrencyFromCents(selected.length * state.ticketPriceCents)
}

function createNumberButton(number) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'number-button'
  button.textContent = formatNumber(number)
  button.dataset.number = String(number)

  const isSold = state.soldNumbers.has(number)
  const isReserved = state.reservedNumbers.has(number)

  if (isSold || isReserved) {
    button.classList.add('sold')
    button.disabled = true
    button.setAttribute(
      'aria-label',
      `Numero ${formatNumber(number)} ${isSold ? 'vendido' : 'reservado'}`
    )
    return button
  }

  button.setAttribute('aria-label', `Numero ${formatNumber(number)}`)

  button.addEventListener('click', () => {
    if (state.selectedNumbers.has(number)) {
      state.selectedNumbers.delete(number)
      button.classList.remove('selected')
    } else {
      state.selectedNumbers.add(number)
      button.classList.add('selected')
    }

    renderSelection()
  })

  return button
}

function renderNumberGrid() {
  if (!grid) return

  grid.innerHTML = ''
  const total = state.raffle?.totalTickets ?? FALLBACK_RAFFLE.totalTickets

  for (let number = 1; number <= total; number += 1) {
    if (!shouldShowNumber(number)) continue
    grid.appendChild(createNumberButton(number))
  }

  state.selectedNumbers.forEach(number => {
    const button = grid.querySelector(`[data-number="${number}"]`)
    if (button) button.classList.add('selected')
  })

  renderSelection()
}

function stopPaymentPolling() {
  if (state.paymentPollId) {
    window.clearInterval(state.paymentPollId)
    state.paymentPollId = null
  }
}

async function pollPaymentStatus(ticketId) {
  try {
    const payment = await api.payments.status(ticketId)
    if (payment?.status === 'APPROVED') {
      stopPaymentPolling()
      showToast('Pagamento confirmado!', 'success')
      state.selectedNumbers.clear()
      state.reservedTickets = []
      state.pixPayments = []
      pixBox.hidden = true
      await refreshRaffleData()
    }
  } catch {
    /* ignora falhas temporarias de polling */
  }
}

async function handlePay() {
  if (!requireAuth()) return
  if (!state.raffle?.id) {
    showToast('Nenhuma rifa publicada disponivel para pagamento', 'error')
    return
  }
  if (state.selectedNumbers.size === 0) {
    showToast('Selecione ao menos um numero', 'error')
    return
  }

  await withLoading(async () => {
    const numbers = [...state.selectedNumbers].sort((a, b) => a - b)
    const reservation = await api.tickets.reserve(state.raffle.id, { numbers })

    state.reservedTickets = reservation.tickets
    state.pixPayments = []

    for (const ticket of reservation.tickets) {
      const checkoutSession = await api.payments.createCheckoutSession(ticket.id)
      state.pixPayments.push(checkoutSession)
    }

    const firstSession = state.pixPayments[0]
    if (!firstSession?.checkoutUrl) {
      throw new Error('O checkout do Stripe não retornou uma URL válida')
    }

    if (state.pixPayments.length === 1) {
      showToast('Redirecionando para o Stripe Checkout', 'success')
      window.location.assign(firstSession.checkoutUrl)
      return
    }

    pixBox.hidden = false
    pixBox.querySelector('strong').textContent = 'Sessões Stripe criadas'
    pixBox.querySelector('p').innerHTML = `${state.pixPayments.length} sessões foram criadas. Finalize cada pagamento no Stripe Checkout:<br>${state.pixPayments
      .map(
        (session, index) =>
          `<a href="${session.checkoutUrl}" target="_blank" rel="noopener">Abrir checkout ${index + 1}</a>`,
      )
      .join('<br>')}`

    showToast('Sessões de checkout criadas com sucesso', 'success')
  })
}

async function handleCheckoutReturn() {
  const params = new URLSearchParams(window.location.search)
  const checkoutState = params.get('checkout')
  const ticketId = params.get('ticketId')

  if (!checkoutState) return

  if (checkoutState === 'cancelled') {
    showToast('Checkout cancelado. Sua reserva permanece ativa até expirar.', 'info')
  }

  if (checkoutState === 'success' && ticketId && api.isAuthenticated()) {
    showToast('Pagamento recebido. Aguardando confirmação do Stripe...', 'info')
    await pollPaymentStatus(ticketId)
    stopPaymentPolling()
    state.paymentPollId = window.setInterval(() => {
      pollPaymentStatus(ticketId)
    }, 3000)
  }

  const cleanUrl = `${window.location.pathname}${window.location.hash || ''}`
  window.history.replaceState({}, document.title, cleanUrl)
}

async function handleAuthSubmit(event) {
  event.preventDefault()
  authError.hidden = true
  setLoading(true)

  try {
    if (state.authMode === 'register') {
      const result = await api.auth.register({
        name: authName.value.trim(),
        email: authEmail.value.trim(),
        cpf: authCpf.value.trim(),
        password: authPassword.value,
        role: 'BUYER',
      })
      state.user = result.user
      showToast('Conta criada com sucesso', 'success')
    } else {
      const result = await api.auth.login({
        email: authEmail.value.trim(),
        password: authPassword.value,
      })
      state.user = result.user
      showToast('Login realizado com sucesso', 'success')
    }

    updateAuthButton()
    closeAuthDialog()
    authForm.reset()
    renderCreatorPanel()
  } catch (error) {
    authError.textContent = error.message
    authError.hidden = false
  } finally {
    setLoading(false)
  }
}

function handleAuthButtonClick() {
  if (state.user) {
    api.auth.logout()
    state.user = null
    updateAuthButton()
    renderCreatorPanel()
    showToast('Sessao encerrada', 'success')
    return
  }

  openAuthDialog('login')
}

function renderCreatorPanel() {
  let panel = document.querySelector('#creatorPanel')

  if (!state.user || !['CREATOR', 'ADMIN'].includes(state.user.role)) {
    if (panel) panel.hidden = true
    return
  }

  if (!panel) {
    panel = document.createElement('div')
    panel.id = 'creatorPanel'
    panel.className = 'creator-panel'
    panel.innerHTML = `
      <div class="section-heading">
        <h3>Gestao da rifa</h3>
      </div>
      <form id="createRaffleForm" class="creator-form">
        <label>Titulo<input type="text" name="title" required minlength="3" maxlength="100" /></label>
        <label>Descricao<textarea name="description" required minlength="10" maxlength="2000"></textarea></label>
        <label>Total de cotas<input type="number" name="totalTickets" min="2" max="100000" value="60" required /></label>
        <label>Preco por cota (centavos)<input type="number" name="ticketPriceCents" min="100" value="1200" required /></label>
        <label>Metodo de sorteio
          <select name="drawMethod">
            <option value="LOTERIA_FEDERAL">Loteria Federal</option>
            <option value="PLATFORM_RANDOM">Aleatorio</option>
          </select>
        </label>
        <label>Data do sorteio<input type="datetime-local" name="drawDate" /></label>
        <label>Concurso Loteria<input type="text" name="loteriaNumber" placeholder="0000" /></label>
        <button class="primary-button" type="submit">Criar rifa (Create)</button>
      </form>
      <div class="creator-actions">
        <button class="ghost-button" type="button" id="publishRaffleBtn">Publicar rifa (Update)</button>
        <button class="ghost-button" type="button" id="drawRaffleBtn">Executar sorteio</button>
        <button class="ghost-button" type="button" id="drawResultBtn">Ver resultado (Read)</button>
        <button class="ghost-button" type="button" id="myTicketsBtn">Minhas cotas (Read)</button>
        <button class="ghost-button" type="button" id="updatePixBtn">Atualizar chave Pix (Update)</button>
      </div>
      <pre id="creatorOutput" class="creator-output" hidden></pre>
    `
    dashboardBand.appendChild(panel)

    panel.querySelector('#createRaffleForm').addEventListener('submit', handleCreateRaffle)
    panel.querySelector('#publishRaffleBtn').addEventListener('click', handlePublishRaffle)
    panel.querySelector('#drawRaffleBtn').addEventListener('click', handleExecuteDraw)
    panel.querySelector('#drawResultBtn').addEventListener('click', handleDrawResult)
    panel.querySelector('#myTicketsBtn').addEventListener('click', handleMyTickets)
    panel.querySelector('#updatePixBtn').addEventListener('click', handleUpdatePixKey)
  }

  panel.hidden = false
}

function showCreatorOutput(data) {
  const output = document.querySelector('#creatorOutput')
  if (!output) return
  output.hidden = false
  output.textContent = JSON.stringify(data, null, 2)
}

async function handleCreateRaffle(event) {
  event.preventDefault()
  const form = event.currentTarget
  const formData = new FormData(form)

  await withLoading(async () => {
    const drawDateValue = formData.get('drawDate')
    const payload = {
      title: String(formData.get('title')),
      description: String(formData.get('description')),
      totalTickets: Number(formData.get('totalTickets')),
      ticketPriceCents: Number(formData.get('ticketPriceCents')),
      drawMethod: String(formData.get('drawMethod')),
    }

    if (drawDateValue) payload.drawDate = new Date(String(drawDateValue)).toISOString()
    if (formData.get('loteriaNumber')) payload.loteriaNumber = String(formData.get('loteriaNumber'))

    const raffle = await api.raffles.create(payload)
    state.raffle = raffle
    showCreatorOutput(raffle)
    await refreshRaffleData()
  }, 'Rifa criada com sucesso')
}

async function handlePublishRaffle() {
  if (!state.raffle) {
    showToast('Selecione ou crie uma rifa primeiro', 'error')
    return
  }

  await withLoading(async () => {
    const raffle = await api.raffles.publish(state.raffle.id)
    state.raffle = raffle
    showCreatorOutput(raffle)
    await refreshRaffleData()
  }, 'Rifa publicada com sucesso')
}

async function handleExecuteDraw() {
  if (!state.raffle) {
    showToast('Nenhuma rifa carregada', 'error')
    return
  }

  await withLoading(async () => {
    const draw = await api.draws.execute(state.raffle.id)
    showCreatorOutput(draw)
    await refreshRaffleData()
  }, 'Sorteio executado')
}

async function handleDrawResult() {
  if (!state.raffle) {
    showToast('Nenhuma rifa carregada', 'error')
    return
  }

  await withLoading(async () => {
    const result = await api.draws.result(state.raffle.id)
    showCreatorOutput(result)
  })
}

async function handleMyTickets() {
  await withLoading(async () => {
    const tickets = await api.tickets.my()
    showCreatorOutput(tickets)
  })
}

async function handleUpdatePixKey() {
  const pixKey = window.prompt('Informe sua chave Pix:')
  if (!pixKey) return

  await withLoading(async () => {
    const result = await api.users.updatePixKey(pixKey.trim())
    showCreatorOutput(result)
  }, 'Chave Pix atualizada')
}

function setupFilters() {
  filterButtons.forEach((button, index) => {
    button.addEventListener('click', () => {
      filterButtons.forEach(item => item.classList.remove('selected'))
      button.classList.add('selected')

      if (index === 1) state.numberFilter = 'available'
      else if (index === 2) state.numberFilter = 'sold'
      else state.numberFilter = 'all'

      renderNumberGrid()
    })
  })
}

function setupNavigationGuard() {
  window.addEventListener('hashchange', guardProtectedRoute)
}

async function bootstrap() {
  state.ticketPriceCents = FALLBACK_RAFFLE.ticketPriceCents
  state.raffle = { ...FALLBACK_RAFFLE }
  pixBox.hidden = true

  setupFilters()
  setupNavigationGuard()
  initTheme()

  authButton.addEventListener('click', handleAuthButtonClick)
  authCloseButton.addEventListener('click', closeAuthDialog)
  toggleAuthMode.addEventListener('click', () => {
    setAuthMode(state.authMode === 'login' ? 'register' : 'login')
  })
  authForm.addEventListener('submit', handleAuthSubmit)
  payButton.addEventListener('click', handlePay)

  updateStats()
  renderNumberGrid()
  guardProtectedRoute()

  try {
    setLoading(true)
    await loadSession()
    await loadFeaturedRaffle()
    renderCreatorPanel()
    await handleCheckoutReturn()
  } catch (error) {
    showToast(error.message || 'Erro ao carregar dados iniciais', 'error')
    renderNumberGrid()
  } finally {
    setLoading(false)
  }
}

bootstrap()
