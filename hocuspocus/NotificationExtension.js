import { createClient } from 'redis'
import { validateNotificationSignalRoom } from './tenantValidation.js'

/** Notification rooms contain no inbox data. Redis events only wake the
 * browser's session-authorized reader; Yjs documents never cache message bodies,
 * links, counts or metadata for a later connection to reuse. */
export class NotificationExtension {
  constructor(config = {}) {
    this.config = config
    this.redisPrefix = config.redisPrefix || ''
    this.subscriber = null
    this.instance = null
    this.subscribed = false
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
      const event = JSON.parse(message)
      if (!['notification.created', 'notification.read', 'notifications.all_read', 'notifications.unread_count'].includes(event.type)) return
      const document = this.instance?.documents?.get(`notification-signals:${tenant}:${userId}`)
      if (!document) return
      document.broadcastStateless(JSON.stringify({ type: 'notifications.changed' }), connection => {
        const access = connection.context?.notificationSignals
        return access?.tenantId === tenant && access?.userId === userId && access.expiresAt > Date.now()
      })
    } catch (error) { console.error('[NotificationExtension] Invalid notification signal:', error) }
  }

  async onDestroy() { if (this.subscriber) await this.subscriber.quit() }
}
