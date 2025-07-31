import crypto from 'crypto';
import type { MCPAuthRequest, MCPSession } from '../types/mcp.js';

export interface AuthConfig {
  apiKeyLength: number;
  sessionTimeoutMs: number;
  maxSessionsPerKey: number;
  keyRotationIntervalMs: number;
}

export interface ApiKeyInfo {
  readonly id: string;
  readonly key: string;
  readonly createdAt: Date;
  readonly metadata: Record<string, any>;
  isActive: boolean;
  lastUsed?: Date;
  usageCount: number;
}

export class AuthenticationProvider {
  private readonly apiKeys = new Map<string, ApiKeyInfo>();
  private readonly sessions = new Map<string, MCPSession>();
  private readonly keyToSessions = new Map<string, Set<string>>();
  
  constructor(private readonly config: AuthConfig) {
    this.startCleanupTimer();
  }

  /**
   * Generate a new API key for debugging access
   */
  generateApiKey(metadata: Record<string, any> = {}): ApiKeyInfo {
    const keyId = crypto.randomUUID();
    const key = this.generateSecureKey();
    
    const apiKeyInfo: ApiKeyInfo = {
      id: keyId,
      key,
      createdAt: new Date(),
      metadata,
      isActive: true,
      usageCount: 0,
    };
    
    this.apiKeys.set(key, apiKeyInfo);
    this.keyToSessions.set(key, new Set());
    
    return apiKeyInfo;
  }

  /**
   * Load API key from environment variable
   */
  loadApiKeyFromEnvironment(apiKey: string): void {
    if (!apiKey || this.apiKeys.has(apiKey)) {
      return;
    }
    
    const apiKeyInfo: ApiKeyInfo = {
      id: 'env-key',
      key: apiKey,
      createdAt: new Date(),
      metadata: { source: 'environment' },
      isActive: true,
      usageCount: 0,
    };
    
    this.apiKeys.set(apiKey, apiKeyInfo);
    this.keyToSessions.set(apiKey, new Set());
    logger.info('Loaded API key from environment', { keyId: 'env-key' });
  }

  /**
   * Validate API key and return key info if valid
   */
  async validateApiKey(apiKey: string): Promise<ApiKeyInfo | null> {
    const keyInfo = this.apiKeys.get(apiKey);
    
    if (!keyInfo || !keyInfo.isActive) {
      return null;
    }
    
    // Update usage
    keyInfo.lastUsed = new Date();
    keyInfo.usageCount++;
    
    return keyInfo;
  }

  /**
   * Authenticate a request and create/validate session
   */
  async authenticate(request: MCPAuthRequest): Promise<MCPSession | null> {
    const keyInfo = await this.validateApiKey(request.apiKey);
    
    if (!keyInfo) {
      return null;
    }
    
    // Check session limits
    const existingSessions = this.keyToSessions.get(request.apiKey);
    if (existingSessions && existingSessions.size >= this.config.maxSessionsPerKey) {
      // Clean up expired sessions first
      await this.cleanupExpiredSessions(request.apiKey);
      
      // Check again after cleanup
      if (existingSessions.size >= this.config.maxSessionsPerKey) {
        throw new Error('Maximum sessions per API key exceeded');
      }
    }
    
    // Create new session
    const sessionId = crypto.randomUUID();
    const session: MCPSession = {
      id: sessionId,
      clientId: request.clientId || 'unknown',
      apiKey: request.apiKey,
      createdAt: new Date(),
      lastActivity: new Date(),
      isActive: true,
      metadata: {
        keyId: keyInfo.id,
        requestId: request.requestId,
      },
    };
    
    this.sessions.set(sessionId, session);
    existingSessions?.add(sessionId);
    
    return session;
  }

  /**
   * Validate session and update activity
   */
  async validateSession(sessionId: string): Promise<MCPSession | null> {
    const session = this.sessions.get(sessionId);
    
    if (!session || !session.isActive) {
      return null;
    }
    
    // Check session timeout
    const now = new Date();
    const sessionAge = now.getTime() - session.lastActivity.getTime();
    
    if (sessionAge > this.config.sessionTimeoutMs) {
      await this.invalidateSession(sessionId);
      return null;
    }
    
    // Update activity
    session.lastActivity = now;
    
    return session;
  }


  /**
   * Invalidate a specific session
   */
  async invalidateSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    
    if (session) {
      session.isActive = false;
      this.sessions.delete(sessionId);
      
      // Remove from key mapping
      const keySessions = this.keyToSessions.get(session.apiKey);
      keySessions?.delete(sessionId);
    }
  }

  /**
   * Revoke an API key and all its sessions
   */
  async revokeApiKey(apiKey: string): Promise<void> {
    const keyInfo = this.apiKeys.get(apiKey);
    
    if (keyInfo) {
      keyInfo.isActive = false;
      
      // Invalidate all sessions for this key
      const sessions = this.keyToSessions.get(apiKey);
      if (sessions) {
        for (const sessionId of sessions) {
          await this.invalidateSession(sessionId);
        }
        sessions.clear();
      }
    }
  }

  /**
   * Get active sessions for monitoring
   */
  getActiveSessions(): MCPSession[] {
    return Array.from(this.sessions.values()).filter(s => s.isActive);
  }

  /**
   * Get API key statistics
   */
  getApiKeyStats(apiKey: string): { sessions: number; lastUsed?: Date; usageCount: number } | null {
    const keyInfo = this.apiKeys.get(apiKey);
    const sessions = this.keyToSessions.get(apiKey);
    
    if (!keyInfo) {
      return null;
    }
    
    return {
      sessions: sessions?.size || 0,
      lastUsed: keyInfo.lastUsed,
      usageCount: keyInfo.usageCount,
    };
  }

  private generateSecureKey(): string {
    return crypto.randomBytes(this.config.apiKeyLength).toString('base64url');
  }

  private async cleanupExpiredSessions(apiKey?: string): Promise<void> {
    const now = new Date();
    const expiredSessions: string[] = [];
    
    for (const [sessionId, session] of this.sessions) {
      if (apiKey && session.apiKey !== apiKey) {
        continue;
      }
      
      const sessionAge = now.getTime() - session.lastActivity.getTime();
      if (sessionAge > this.config.sessionTimeoutMs) {
        expiredSessions.push(sessionId);
      }
    }
    
    for (const sessionId of expiredSessions) {
      await this.invalidateSession(sessionId);
    }
  }

  private startCleanupTimer(): void {
    setInterval(() => {
      this.cleanupExpiredSessions().catch(console.error);
    }, Math.min(this.config.sessionTimeoutMs / 2, 300000)); // Max 5 minutes
  }
}