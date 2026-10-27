import { createClient } from 'redis'
import { validateNotificationSignalRoom, validateLegacyNotificationRoom } from './tenantValidation.js'

/** Inbox events that collapse to a content-free wake-up. */
const NOTIFICATION_CHANGE_EVENTS = ['notification.created', 'notification.read', 'notifications.all_read', 'notifications.unread_count']

/** Maps a Redis event onto the stateless signal this room relays, or null when the
 * room relays nothing for it.
 *
 * Inbox events carry no payload at all: bodies, links, counts and metadata stay in
 * the database behind the browser's own session-authorized read.
 *
 * The telephony ring is the one payload-carrying signal, and it stays inside the
 * invariant because it is *stateless*: broadcastStateless is filtered per
 * connection by tenant/user/expiry and is never written to a Yjs map, so nothing
 * is retained for a later connection to replay. */
export function toNotificationSignal(event) {
  if (NOTIFICATION_CHANGE_EVENTS.includes(event?.type)) return { type: 'notifications.changed' }
  if (event?.type === 'telephony.incoming_call' && event.event && event.call && typeof event.call === 'object') {
    return { type: 'telephony.incoming_call',
      entry: { event: event.event, call: event.call, receivedAt: event.timestamp || new Date().toISOString() } }
  }
  return null
}

/** Signal rooms contain no inbox data. Redis events only wake the browser's
 * session-authorized reader; Yjs documents never cache message bodies, links,
 * counts or metadata for a later connection to reuse. The one exception is the
 * flag-gated legacy `notifications:` relay below, kept only for the rollout window. */
export class NotificationExtension {
  constructor(config = {}) {
    this.config = config
    this.redisPrefix = config.redisPrefix || ''
    this.subscriber = null
    this.instance = null
    this.subscribed = false
    this.legacySubscriptions = new Map() // channel -> { connections, roomName }; rollout window only
    this.handleMessage = this.handleMessage.bind(this)
  }

  async onConfigure({ instance }) {
    this.instance = instance
    this.subscriber = (this.config.createClient || createClient)({ socket: { host: this.config.redisHost || 'localhost', port: this.config.redisPort || 6379 },
      username: this.config.redisUsername || 'default', password: this.config.redisPassword })
    this.subscriber.on('error', error => console.error('[NotificationExtension] Redis error:', error))
    this.subscriber.on('ready', async () => { this.subscribed = false; await this.subscribe() })
    this.subscriber.on('end', () => { this.subscribed = false })
    await this.subscriber.connect()
    await this.subscribe()
  }

  async subscribe() {
    if (!this.subscriber || this.subscribed) return
    // Set before awaiting so initial connect/ready cannot register twice.
    this.subscribed = true
    try { await this.subscriber.pSubscribe(`${this.redisPrefix}internal-notifications:*`, this.handleMessage) }
    catch (error) { this.subscribed = false; throw error }
  }

  async onConnect(data) {
    if (data.documentName?.startsWith('notifications:')) return this.onLegacyConnect(data)
    if (!data.documentName?.startsWith('notification-signals:')) return
    const access = validateNotificationSignalRoom(data.documentName, data.request)
    data.connection.readOnly = true
    return { notificationSignals: access }
  }

  async beforeHandleMessage(data) {
    if (!data.documentName?.startsWith('notification-signals:')) return
    if (!data.context?.notificationSignals || data.context.notificationSignals.expiresAt <= Date.now()) {
      throw new Error('Notification signal token expired')
    }
  }

  async handleMessage(message, channel) {
    try {
      const prefix = `${this.redisPrefix}internal-notifications:`
      if (!channel.startsWith(prefix)) return
      const parts = channel.slice(prefix.length).split(':')
      if (parts.length !== 2) return
      const [tenant, userId] = parts
      const signal = toNotificationSignal(JSON.parse(message))
      if (!signal) return
      const document = this.instance?.documents?.get(`notification-signals:${tenant}:${userId}`)
      if (!document) return
      document.broadcastStateless(JSON.stringify(signal), connection => {
        const access = connection.context?.notificationSignals
        return access?.tenantId === tenant && access?.userId === userId && access.expiresAt > Date.now()
      })
    } catch (error) { console.error('[NotificationExtension] Invalid notification signal:', error) }
  }

  async onDisconnect(data) {
    if (data.documentName?.startsWith('notifications:')) await this.onLegacyDisconnect(data)
  }

  // LEVERAGE: friction legacy-notification-room-window — everything below exists
  // only so tabs on the pre-signal bundle keep working while
  // HOCUSPOCUS_LEGACY_NOTIFICATION_ROOMS is open. Delete with the flag.
  legacyChannel(roomName) {
    const [, tenant, userId] = roomName.split(':')
    return `${this.redisPrefix}internal-notifications:${tenant}:${userId}`
  }

  async onLegacyConnect(data) {
    // Re-validated here (not only in server.js) so this path can never subscribe
    // for a room the gate refused, whatever the hook order.
    validateLegacyNotificationRoom(data.documentName, data.request)
    const channel = this.legacyChannel(data.documentName)
    const existing = this.legacySubscriptions.get(channel)
    if (existing) { existing.connections++; return }
    this.legacySubscriptions.set(channel, { connections: 1, roomName: data.documentName })
    await this.subscriber.subscribe(channel, message => this.relayLegacy(data.documentName, message))
  }

  async onLegacyDisconnect(data) {
    const channel = this.legacyChannel(data.documentName)
    const subscription = this.legacySubscriptions.get(channel)
    if (!subscription) return
    if (--subscription.connections > 0) return
    this.legacySubscriptions.delete(channel)
    await this.subscriber.unsubscribe(channel)
  }

  /** Pre-signal clients read bodies out of the room's Yjs maps. */
  relayLegacy(roomName, message) {
    try {
      const event = JSON.parse(message)
      const doc = this.instance?.documents?.get(roomName)
      if (!doc) return
      const notifications = () => doc.getMap('notifications')
      const unread = () => doc.getMap('unreadCount')
      if (event.type === 'notification.created') {
        notifications().set('data', [event.notification, ...(notifications().get('data') || [])])
        unread().set('count', (unread().get('count') || 0) + 1)
      } else if (event.type === 'notification.read') {
        notifications().set('data', (notifications().get('data') || []).map(n =>
          n.internal_notification_id === event.notificationId ? { ...n, is_read: true, read_at: event.timestamp } : n))
        unread().set('count', Math.max(0, (unread().get('count') || 0) - 1))
      } else if (event.type === 'notifications.all_read') {
        notifications().set('data', (notifications().get('data') || []).map(n => ({ ...n, is_read: true, read_at: event.timestamp })))
        unread().set('count', 0)
      } else if (event.type === 'telephony.incoming_call') {
        doc.getMap('incomingCall').set('data', { event: event.event, call: event.call,
          receivedAt: event.timestamp || new Date().toISOString() })
      }
    } catch (error) { console.error('[NotificationExtension] Error handling legacy message:', error) }
  }

  async onDestroy() { if (this.subscriber) await this.subscriber.quit() }
}
