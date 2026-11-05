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
    this.listChangeAuthorizationUrl = config.listChangeAuthorizationUrl || 'http://server:3000/api/internal/tickets/live-change'
    this.listChangeApiKey = config.listChangeApiKey || ''
    this.pattern = `${this.redisPrefix}ticket-updates:*`
    this.listPattern = `${this.redisPrefix}ticket-list-changes:*`
    this.subscriber = null
    this.instance = null
    this.hasPatternSubscription = false
    this.listConnections = new Map()
    this.connectionExpiryTimers = new Map()
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
      const roomName = `tenant:${tenantId}:ticket-changes`
      const document = this.instance?.documents?.get(roomName)
      if (!document || !this.listChangeApiKey) return
      const event = JSON.parse(message)
      if (typeof event.ticketId !== 'string' || typeof event.updatedAt !== 'string') return
      const roomConnections = this.listConnections.get(roomName)
      if (!roomConnections?.size) return
      const users = new Map()
      for (const connection of roomConnections) {
        const access = connection.context?.ticketChangesAccess
        if (access?.tenantId === tenantId && access.expiresAt > Date.now()) users.set(access.userId, access)
      }
      for (const access of users.values()) {
        try {
          const response = await fetch(this.listChangeAuthorizationUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': this.listChangeApiKey },
            body: JSON.stringify({ tenantId, userId: access.userId, ticketId: event.ticketId, event }),
          })
          if (!response.ok) continue
          const result = await response.json()
          if (!result?.change) continue
          // Each instance consumes the trusted activity feed independently.
          // Document.broadcastStateless invokes extension-redis before applying
          // its local filter, which would leak this recipient's payload to all
          // room connections on other instances. Send only on authorized local
          // connections; never put enriched payloads on the room broadcast bus.
          const payload = JSON.stringify(result.change)
          for (const connection of roomConnections) {
            const recipient = connection.context?.ticketChangesAccess
            if (recipient?.tenantId === tenantId && recipient.userId === access.userId && recipient.expiresAt > Date.now()) {
              connection.sendStateless(payload)
            }
          }
        } catch (error) {
          console.error(`[TicketUpdatesExtension] Unable to authorize ticket change for ${access.userId}:`, error)
        }
      }
    } catch (error) {
      console.error('[TicketUpdatesExtension] Error handling ticket list change:', error)
    }
  }

  async connected(data) {
    if (!data.documentName?.startsWith('tenant:') || !data.documentName.endsWith(':ticket-changes')) return
    const access = data.context?.ticketChangesAccess
    const connection = data.connectionInstance
    if (!access || !connection || access.expiresAt <= Date.now()) return
    let connections = this.listConnections.get(data.documentName)
    if (!connections) { connections = new Set(); this.listConnections.set(data.documentName, connections) }
    connections.add(connection)
    this.connectionExpiryTimers.set(connection, setTimeout(() => connection.close(), Math.max(0, access.expiresAt - Date.now()) + 1))
  }

  async onDisconnect(data) {
    if (!data.documentName?.startsWith('tenant:') || !data.documentName.endsWith(':ticket-changes')) return
    const connections = this.listConnections.get(data.documentName)
    if (!connections) return
    // Hocuspocus's disconnect hook supplies socketId, not connectionInstance.
    for (const connection of connections) {
      if (connection !== data.connectionInstance && (!data.socketId || connection.socketId !== data.socketId)) continue
      const timer = this.connectionExpiryTimers.get(connection)
      if (timer) clearTimeout(timer)
      this.connectionExpiryTimers.delete(connection)
      connections.delete(connection)
    }
    if (connections.size === 0) this.listConnections.delete(data.documentName)
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
    this.listConnections.clear()
    for (const timer of this.connectionExpiryTimers.values()) clearTimeout(timer)
    this.connectionExpiryTimers.clear()
    if (this.subscriber) {
      await this.subscriber.quit()
    }
  }
}

export { parseTicketUpdateChannel }
