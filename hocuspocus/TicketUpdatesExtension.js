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
    this.subscriber = null
    this.instance = null
    this.hasPatternSubscription = false
    this.handlePatternMessage = this.handlePatternMessage.bind(this)
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
    this.hasPatternSubscription = true
    console.log(`[TicketUpdatesExtension] Pattern subscribed to ${this.pattern}`)
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
