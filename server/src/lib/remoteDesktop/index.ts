/**
 * Remote Desktop Module Entry Point
 * Provides signaling server management for WebRTC remote desktop support
 */

import { SignalingServer } from './SignalingServer';
import { Server as HttpServer } from 'http';
import logger from '@alga-psa/shared/core/logger';

let signalingServer: SignalingServer | null = null;

export interface SignalingServerOptions {
  port?: number;
  server?: HttpServer;
  path?: string;
}

/**
 * Start the WebSocket signaling server
 * Can be started either on a specific port or attached to an existing HTTP server
 */
export function startSignalingServer(options: SignalingServerOptions = {}): SignalingServer {
  if (signalingServer) {
    logger.info('Signaling server already running');
    return signalingServer;
  }

  const { port, server, path = '/ws/rd-signal' } = options;

  signalingServer = new SignalingServer({
    port,
    server,
    path,
  });

  logger.info(`Remote Desktop signaling server started on path ${path}`);

  return signalingServer;
}

/**
 * Stop the WebSocket signaling server
 */
export function stopSignalingServer() {
  if (signalingServer) {
    signalingServer.close();
    signalingServer = null;
    logger.info('Remote Desktop signaling server stopped');
  }
}

/**
 * Get the current signaling server instance
 */
export function getSignalingServer(): SignalingServer | null {
  return signalingServer;
}

/**
 * Check if the signaling server is running
 */
export function isSignalingServerRunning(): boolean {
  return signalingServer !== null;
}

export { SignalingServer };
