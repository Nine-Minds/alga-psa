import { createClient } from 'redis'

function parseTicketUpdateChannel(channel, redisPrefix = '') {
  const normalizedChannel = redisPrefix && channel.startsWith(redisPrefix)
    ? channel.slice(redisPrefix.length)
    : channel

  if (!normalizedChannel.startsWith('ticket-updates:')) {
    return null
  }

  const parts = normalizedChannel.split(':')
  if (parts.length !== 3) {
    return null
  }

  const [, tenantId, ticketId] = parts
  if (!tenantId || !ticketId) {
    return null
  }

  return { tenantId, ticketId }
}

export class TicketUpdatesExtension {
  constructor(config = {}) {
    this.redisHost = config.redisHost || 'localhost'
    this.redisPort = config.redisPort || 6379
    this.redisUsername = config.redisUsername || 'default'
    this.redisPassword = config.redisPassword
    this.redisPrefix = config.redisPrefix || ''
    this.pattern = `${this.redisPrefix}ticket-updates:*`
    this.listPattern = `${this.redisPrefix}ticket-list-changes:*`
    this.subscriber = null
    this.instance = null
    this.hasPatternSubscription = false
    this.handlePatternMessage = this.handlePatternMessage.bind(this)
    this.handleListMessage = this.handleListMessage.bind(this)
  }

  async onConfigure({ instance }) {
    this.instance = instance
    this.subscriber = createClient({
      socket: {
        host: this.redisHost,
        port: this.redisPort,
      },
      username: this.redisUsername,
      password: this.redisPassword,
    })

    this.subscriber.on('error', (err) => {
      console.error('[TicketUpdatesExtension] Redis error:', err)
    })

    this.subscriber.on('ready', async () => {
      // Redis drops server-side subscriptions on every reconnect; treat each
      // 'ready' as a fresh session and re-issue pSubscribe.
      this.hasPatternSubscription = false
      await this.ensurePatternSubscription()
    })

    this.subscriber.on('end', () => {
      this.hasPatternSubscription = false
    })

    await this.subscriber.connect()
    console.log('[TicketUpdatesExtension] Connected to Redis for pub/sub')
    await this.ensurePatternSubscription()
  }

  async ensurePatternSubscription() {
    if (!this.subscriber || this.hasPatternSubscription) {
      return
    }

    await this.subscriber.pSubscribe(this.pattern, this.handlePatternMessage)
    await this.subscriber.pSubscribe(this.listPattern, this.handleListMessage)
    this.hasPatternSubscription = true
    console.log(`[TicketUpdatesExtension] Pattern subscribed to ${this.pattern}`)
  }

  async handleListMessage(message, channel) {
    try {
      const prefix = `${this.redisPrefix}ticket-list-changes:`
      if (!channel.startsWith(prefix)) return
      const tenantId = channel.slice(prefix.length)
      if (!tenantId || tenantId.includes(':')) return
      const document = this.instance?.documents?.get(`tenant:${tenantId}:ticket-changes`)
      if (document) document.broadcastStateless(message)
    } catch (error) {
      console.error('[TicketUpdatesExtension] Error handling ticket list change:', error)
    }
  }

  async handlePatternMessage(message, channel) {
    try {
      const room = parseTicketUpdateChannel(channel, this.redisPrefix)
      if (!room) {
        return
      }

      const documentName = `ticket:${room.tenantId}:${room.ticketId}`
      const document = this.instance?.documents?.get(documentName)
      if (!document) {
        return
      }

      const payload = JSON.parse(message)
      console.log('[TicketUpdatesExtension] Broadcasting ticket update for room:', documentName)
      document.broadcastStateless(JSON.stringify(payload))
    } catch (error) {
      console.error('[TicketUpdatesExtension] Error handling message:', error)
    }
  }

  async onDestroy() {
    if (this.subscriber) {
      await this.subscriber.quit()
    }
  }
}

export { parseTicketUpdateChannel }
