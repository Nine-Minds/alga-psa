import { createClient } from 'redis'

/**
 * Hocuspocus extension that bridges Redis Pub/Sub notifications to Y.js documents
 * Listens for internal notification events and updates the corresponding Y.js documents
 */
export class NotificationExtension {
  constructor(config = {}) {
    this.redisHost = config.redisHost || 'localhost'
    this.redisPort = config.redisPort || 6379
    this.redisUsername = config.redisUsername || 'default'
    this.redisPassword = config.redisPassword
    this.redisPrefix = config.redisPrefix || ''
    this.subscriber = null
    this.subscriptions = new Map() // Track active subscriptions per room
    this.instance = null // Store Hocuspocus instance
  }

  async onConfigure({ instance }) {
    this.instance = instance // Store the instance reference
    // Create Redis subscriber client
    this.subscriber = createClient({
      socket: {
        host: this.redisHost,
        port: this.redisPort
      },
      username: this.redisUsername,
      password: this.redisPassword
    })

    this.subscriber.on('error', (err) => {
      console.error('[NotificationExtension] Redis error:', err)
    })

    await this.subscriber.connect()
    console.log('[NotificationExtension] Connected to Redis for pub/sub')
  }

  async onDestroy() {
    if (this.subscriber) {
      await this.subscriber.quit()
    }
  }

  /**
   * Called when a new connection is established
   * Subscribe to Redis channel for this room's notifications
   */
  async onConnect(data) {
    const roomName = data.documentName

    // Only handle notification rooms (format: notifications:tenant:userId)
    if (!roomName.startsWith('notifications:')) {
      return
    }

    // Extract tenant and userId from room name
    const parts = roomName.split(':')
    if (parts.length !== 3) {
      return
    }

    const [, tenant, userId] = parts
    const channel = `${this.redisPrefix}internal-notifications:${tenant}:${userId}`

    // Skip if already subscribed to this channel
    if (this.subscriptions.has(channel)) {
      this.subscriptions.get(channel).connections++
      console.log(`[NotificationExtension] Connection added to ${channel}, total: ${this.subscriptions.get(channel).connections}`)
      return
    }

    console.log(`[NotificationExtension] Subscribing to ${channel}`)

    // Subscribe to the channel
    await this.subscriber.subscribe(channel, async (message) => {
      try {
        const event = JSON.parse(message)
        console.log('[NotificationExtension] Received event:', event.type, 'for room:', roomName)

        // Get the Y.js document for this room using the stored instance
        const doc = this.instance.documents.get(roomName)

        if (event.type === 'notification.created') {
          // Add new notification to the notifications map
          const notificationsMap = doc.getMap('notifications')
          const unreadCountMap = doc.getMap('unreadCount')

          // Get current notifications or initialize empty array
          const currentNotifications = notificationsMap.get('data') || []

          // Prepend new notification to the list
          const updatedNotifications = [event.notification, ...currentNotifications]
          notificationsMap.set('data', updatedNotifications)

          // Increment unread count
          const currentCount = unreadCountMap.get('count') || 0
          unreadCountMap.set('count', currentCount + 1)

          console.log('[NotificationExtension] Added notification to Y.js document')
        } else if (event.type === 'notification.read') {
          // Mark notification as read
          const notificationsMap = doc.getMap('notifications')
          const unreadCountMap = doc.getMap('unreadCount')

          const currentNotifications = notificationsMap.get('data') || []
          const updatedNotifications = currentNotifications.map(n =>
            n.internal_notification_id === event.notificationId
              ? { ...n, is_read: true, read_at: event.timestamp }
              : n
          )
          notificationsMap.set('data', updatedNotifications)

          // Decrement unread count
          const currentCount = unreadCountMap.get('count') || 0
          unreadCountMap.set('count', Math.max(0, currentCount - 1))
        } else if (event.type === 'notifications.all_read') {
          // Mark all notifications as read
          const notificationsMap = doc.getMap('notifications')
          const unreadCountMap = doc.getMap('unreadCount')

          const currentNotifications = notificationsMap.get('data') || []
          const updatedNotifications = currentNotifications.map(n => ({
            ...n,
            is_read: true,
            read_at: event.timestamp
          }))
          notificationsMap.set('data', updatedNotifications)
          unreadCountMap.set('count', 0)
        }
      } catch (error) {
        console.error('[NotificationExtension] Error handling message:', error)
      }
    })

    // Track this subscription
    this.subscriptions.set(channel, {
      connections: 1,
      roomName
    })
  }

  /**
   * Called when a connection is closed
   * Unsubscribe from Redis channel if this was the last connection for this room
   */
  async onDisconnect(data) {
    const roomName = data.documentName

    if (!roomName.startsWith('notifications:')) {
      return
    }

    const parts = roomName.split(':')
    if (parts.length !== 3) {
      return
    }

    const [, tenant, userId] = parts
    const channel = `${this.redisPrefix}internal-notifications:${tenant}:${userId}`

    const subscription = this.subscriptions.get(channel)
    if (!subscription) {
      return
    }

    subscription.connections--

    if (subscription.connections <= 0) {
      console.log(`[NotificationExtension] Unsubscribing from ${channel}`)
      await this.subscriber.unsubscribe(channel)
      this.subscriptions.delete(channel)
    } else {
      console.log(`[NotificationExtension] Connection removed from ${channel}, remaining: ${subscription.connections}`)
    }
  }
}
