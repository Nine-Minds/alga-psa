/**
 * Adaptive Bitrate Controller
 *
 * Dynamically adjusts video encoding quality based on network conditions.
 * Monitors RTT, packet loss, and bandwidth to optimize streaming quality
 * while maintaining smooth playback.
 */

import { EventEmitter } from 'events';

/**
 * Quality level configuration
 */
export interface QualityLevel {
  /** Quality level name */
  name: string;
  /** Target bitrate in bits per second */
  bitrate: number;
  /** Target frame rate */
  frameRate: number;
  /** Resolution scale factor (1.0 = native) */
  resolutionScale: number;
  /** Encoder preset (lower = better quality but slower) */
  encoderPreset: 'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'fast' | 'medium';
}

/**
 * Network statistics for quality decisions
 */
export interface NetworkStats {
  /** Round-trip time in milliseconds */
  rtt: number;
  /** Packet loss percentage (0-100) */
  packetLoss: number;
  /** Available bandwidth in bits per second */
  availableBandwidth: number;
  /** Jitter in milliseconds */
  jitter: number;
}

/**
 * Encoder statistics
 */
export interface EncoderStats {
  /** Current encoding bitrate */
  currentBitrate: number;
  /** Frames encoded per second */
  framesPerSecond: number;
  /** Frames dropped due to encoding backpressure */
  droppedFrames: number;
  /** Encoding queue depth */
  queueDepth: number;
  /** Average encode time per frame in ms */
  avgEncodeTime: number;
}

/**
 * Adaptive bitrate controller configuration
 */
export interface AdaptiveBitrateConfig {
  /** Minimum bitrate in bps (default: 500 Kbps) */
  minBitrate?: number;
  /** Maximum bitrate in bps (default: 10 Mbps) */
  maxBitrate?: number;
  /** Target frame rate (default: 30) */
  targetFrameRate?: number;
  /** RTT threshold for quality reduction in ms (default: 150) */
  rttThreshold?: number;
  /** Packet loss threshold for quality reduction (default: 2%) */
  packetLossThreshold?: number;
  /** How often to evaluate quality in ms (default: 2000) */
  evaluationInterval?: number;
  /** Number of samples to average for decisions (default: 5) */
  sampleWindow?: number;
  /** Stability period before upgrading quality in ms (default: 10000) */
  upgradeStabilityPeriod?: number;
}

/**
 * Predefined quality levels
 */
export const QUALITY_LEVELS: QualityLevel[] = [
  {
    name: 'minimum',
    bitrate: 500_000, // 500 Kbps
    frameRate: 15,
    resolutionScale: 0.5,
    encoderPreset: 'ultrafast',
  },
  {
    name: 'low',
    bitrate: 1_000_000, // 1 Mbps
    frameRate: 24,
    resolutionScale: 0.75,
    encoderPreset: 'superfast',
  },
  {
    name: 'medium',
    bitrate: 2_500_000, // 2.5 Mbps
    frameRate: 30,
    resolutionScale: 1.0,
    encoderPreset: 'veryfast',
  },
  {
    name: 'high',
    bitrate: 5_000_000, // 5 Mbps
    frameRate: 30,
    resolutionScale: 1.0,
    encoderPreset: 'faster',
  },
  {
    name: 'ultra',
    bitrate: 10_000_000, // 10 Mbps
    frameRate: 60,
    resolutionScale: 1.0,
    encoderPreset: 'fast',
  },
];

/**
 * Quality change event
 */
export interface QualityChangeEvent {
  previousLevel: QualityLevel;
  newLevel: QualityLevel;
  reason: 'rtt' | 'packet_loss' | 'bandwidth' | 'encoder_backpressure' | 'stability';
}

/**
 * Adaptive Bitrate Controller
 *
 * Manages video quality based on network and encoder conditions.
 */
export class AdaptiveBitrateController extends EventEmitter {
  private config: Required<AdaptiveBitrateConfig>;
  private currentLevelIndex: number;
  private networkSamples: NetworkStats[] = [];
  private encoderSamples: EncoderStats[] = [];
  private evaluationTimer: NodeJS.Timeout | null = null;
  private lastDowngradeTime = 0;
  private lastUpgradeTime = 0;
  private stableTime = 0;

  constructor(config: AdaptiveBitrateConfig = {}) {
    super();

    this.config = {
      minBitrate: config.minBitrate ?? 500_000,
      maxBitrate: config.maxBitrate ?? 10_000_000,
      targetFrameRate: config.targetFrameRate ?? 30,
      rttThreshold: config.rttThreshold ?? 150,
      packetLossThreshold: config.packetLossThreshold ?? 2,
      evaluationInterval: config.evaluationInterval ?? 2000,
      sampleWindow: config.sampleWindow ?? 5,
      upgradeStabilityPeriod: config.upgradeStabilityPeriod ?? 10000,
    };

    // Start at medium quality
    this.currentLevelIndex = this.findLevelIndex('medium');
  }

  /**
   * Get current quality level
   */
  getCurrentLevel(): QualityLevel {
    return QUALITY_LEVELS[this.currentLevelIndex];
  }

  /**
   * Get all available quality levels
   */
  getQualityLevels(): QualityLevel[] {
    return [...QUALITY_LEVELS];
  }

  /**
   * Find quality level index by name
   */
  private findLevelIndex(name: string): number {
    const index = QUALITY_LEVELS.findIndex((l) => l.name === name);
    return index >= 0 ? index : 2; // Default to medium
  }

  /**
   * Start automatic quality adaptation
   */
  start(): void {
    if (this.evaluationTimer) return;

    this.evaluationTimer = setInterval(() => {
      this.evaluateQuality();
    }, this.config.evaluationInterval);
  }

  /**
   * Stop automatic quality adaptation
   */
  stop(): void {
    if (this.evaluationTimer) {
      clearInterval(this.evaluationTimer);
      this.evaluationTimer = null;
    }
  }

  /**
   * Report network statistics
   */
  reportNetworkStats(stats: NetworkStats): void {
    this.networkSamples.push(stats);

    // Keep only recent samples
    while (this.networkSamples.length > this.config.sampleWindow) {
      this.networkSamples.shift();
    }
  }

  /**
   * Report encoder statistics
   */
  reportEncoderStats(stats: EncoderStats): void {
    this.encoderSamples.push(stats);

    // Keep only recent samples
    while (this.encoderSamples.length > this.config.sampleWindow) {
      this.encoderSamples.shift();
    }
  }

  /**
   * Calculate average network statistics
   */
  private getAverageNetworkStats(): NetworkStats | null {
    if (this.networkSamples.length === 0) return null;

    const sum = this.networkSamples.reduce(
      (acc, s) => ({
        rtt: acc.rtt + s.rtt,
        packetLoss: acc.packetLoss + s.packetLoss,
        availableBandwidth: acc.availableBandwidth + s.availableBandwidth,
        jitter: acc.jitter + s.jitter,
      }),
      { rtt: 0, packetLoss: 0, availableBandwidth: 0, jitter: 0 }
    );

    const count = this.networkSamples.length;

    return {
      rtt: sum.rtt / count,
      packetLoss: sum.packetLoss / count,
      availableBandwidth: sum.availableBandwidth / count,
      jitter: sum.jitter / count,
    };
  }

  /**
   * Calculate average encoder statistics
   */
  private getAverageEncoderStats(): EncoderStats | null {
    if (this.encoderSamples.length === 0) return null;

    const sum = this.encoderSamples.reduce(
      (acc, s) => ({
        currentBitrate: acc.currentBitrate + s.currentBitrate,
        framesPerSecond: acc.framesPerSecond + s.framesPerSecond,
        droppedFrames: acc.droppedFrames + s.droppedFrames,
        queueDepth: acc.queueDepth + s.queueDepth,
        avgEncodeTime: acc.avgEncodeTime + s.avgEncodeTime,
      }),
      {
        currentBitrate: 0,
        framesPerSecond: 0,
        droppedFrames: 0,
        queueDepth: 0,
        avgEncodeTime: 0,
      }
    );

    const count = this.encoderSamples.length;

    return {
      currentBitrate: sum.currentBitrate / count,
      framesPerSecond: sum.framesPerSecond / count,
      droppedFrames: sum.droppedFrames / count,
      queueDepth: sum.queueDepth / count,
      avgEncodeTime: sum.avgEncodeTime / count,
    };
  }

  /**
   * Evaluate current conditions and adjust quality
   */
  private evaluateQuality(): void {
    const networkStats = this.getAverageNetworkStats();
    const encoderStats = this.getAverageEncoderStats();

    if (!networkStats) return;

    const now = Date.now();
    const currentLevel = this.getCurrentLevel();
    let shouldDowngrade = false;
    let shouldUpgrade = false;
    let reason: QualityChangeEvent['reason'] = 'stability';

    // Check for conditions requiring downgrade
    if (networkStats.rtt > this.config.rttThreshold) {
      shouldDowngrade = true;
      reason = 'rtt';
    } else if (networkStats.packetLoss > this.config.packetLossThreshold) {
      shouldDowngrade = true;
      reason = 'packet_loss';
    } else if (
      networkStats.availableBandwidth > 0 &&
      networkStats.availableBandwidth < currentLevel.bitrate * 0.8
    ) {
      shouldDowngrade = true;
      reason = 'bandwidth';
    }

    // Check encoder backpressure
    if (encoderStats) {
      if (encoderStats.queueDepth > 5 || encoderStats.droppedFrames > 2) {
        shouldDowngrade = true;
        reason = 'encoder_backpressure';
      }
    }

    // Check for conditions allowing upgrade
    if (!shouldDowngrade) {
      const timeSinceDowngrade = now - this.lastDowngradeTime;
      const timeSinceUpgrade = now - this.lastUpgradeTime;

      // Only upgrade if stable for a period
      if (
        timeSinceDowngrade > this.config.upgradeStabilityPeriod &&
        timeSinceUpgrade > this.config.upgradeStabilityPeriod
      ) {
        // Check if we have headroom for upgrade
        if (
          networkStats.rtt < this.config.rttThreshold * 0.7 &&
          networkStats.packetLoss < this.config.packetLossThreshold * 0.5 &&
          this.currentLevelIndex < QUALITY_LEVELS.length - 1
        ) {
          const nextLevel = QUALITY_LEVELS[this.currentLevelIndex + 1];
          if (
            networkStats.availableBandwidth === 0 ||
            networkStats.availableBandwidth > nextLevel.bitrate * 1.2
          ) {
            shouldUpgrade = true;
            reason = 'stability';
          }
        }
      }
    }

    // Apply quality change
    if (shouldDowngrade && this.currentLevelIndex > 0) {
      const previousLevel = currentLevel;
      this.currentLevelIndex--;
      this.lastDowngradeTime = now;

      this.emit('quality-change', {
        previousLevel,
        newLevel: this.getCurrentLevel(),
        reason,
      } as QualityChangeEvent);
    } else if (shouldUpgrade && this.currentLevelIndex < QUALITY_LEVELS.length - 1) {
      const previousLevel = currentLevel;
      this.currentLevelIndex++;
      this.lastUpgradeTime = now;

      this.emit('quality-change', {
        previousLevel,
        newLevel: this.getCurrentLevel(),
        reason,
      } as QualityChangeEvent);
    }
  }

  /**
   * Manually set quality level
   */
  setQualityLevel(name: string): boolean {
    const index = this.findLevelIndex(name);
    if (index < 0) return false;

    if (index !== this.currentLevelIndex) {
      const previousLevel = this.getCurrentLevel();
      this.currentLevelIndex = index;

      this.emit('quality-change', {
        previousLevel,
        newLevel: this.getCurrentLevel(),
        reason: 'stability',
      } as QualityChangeEvent);
    }

    return true;
  }

  /**
   * Force downgrade by one level
   */
  forceDowngrade(): boolean {
    if (this.currentLevelIndex <= 0) return false;

    const previousLevel = this.getCurrentLevel();
    this.currentLevelIndex--;
    this.lastDowngradeTime = Date.now();

    this.emit('quality-change', {
      previousLevel,
      newLevel: this.getCurrentLevel(),
      reason: 'stability',
    } as QualityChangeEvent);

    return true;
  }

  /**
   * Get recommended encoder settings for current quality
   */
  getEncoderSettings(): {
    bitrate: number;
    frameRate: number;
    resolutionScale: number;
    preset: string;
  } {
    const level = this.getCurrentLevel();

    return {
      bitrate: Math.min(Math.max(level.bitrate, this.config.minBitrate), this.config.maxBitrate),
      frameRate: level.frameRate,
      resolutionScale: level.resolutionScale,
      preset: level.encoderPreset,
    };
  }

  /**
   * Get diagnostic information
   */
  getDiagnostics(): {
    currentLevel: QualityLevel;
    networkStats: NetworkStats | null;
    encoderStats: EncoderStats | null;
    lastDowngradeTime: number;
    lastUpgradeTime: number;
  } {
    return {
      currentLevel: this.getCurrentLevel(),
      networkStats: this.getAverageNetworkStats(),
      encoderStats: this.getAverageEncoderStats(),
      lastDowngradeTime: this.lastDowngradeTime,
      lastUpgradeTime: this.lastUpgradeTime,
    };
  }
}

/**
 * Create a bandwidth estimator using WebRTC stats
 */
export function createBandwidthEstimator(
  peerConnection: RTCPeerConnection,
  callback: (stats: NetworkStats) => void,
  interval = 1000
): () => void {
  let lastBytesSent = 0;
  let lastTimestamp = 0;

  const collectStats = async () => {
    try {
      const stats = await peerConnection.getStats();
      let rtt = 0;
      let packetLoss = 0;
      let jitter = 0;
      let bytesSent = 0;
      let packetsLost = 0;
      let packetsSent = 0;

      stats.forEach((report) => {
        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          rtt = report.currentRoundTripTime ? report.currentRoundTripTime * 1000 : 0;
        }

        if (report.type === 'outbound-rtp' && report.kind === 'video') {
          bytesSent = report.bytesSent || 0;
          packetsSent = report.packetsSent || 0;
        }

        if (report.type === 'remote-inbound-rtp' && report.kind === 'video') {
          packetsLost = report.packetsLost || 0;
          jitter = report.jitter ? report.jitter * 1000 : 0;
        }
      });

      // Calculate bandwidth
      const now = Date.now();
      let availableBandwidth = 0;

      if (lastTimestamp > 0) {
        const timeDelta = (now - lastTimestamp) / 1000;
        const bytesDelta = bytesSent - lastBytesSent;
        availableBandwidth = (bytesDelta * 8) / timeDelta; // bits per second
      }

      lastBytesSent = bytesSent;
      lastTimestamp = now;

      // Calculate packet loss percentage
      if (packetsSent > 0) {
        packetLoss = (packetsLost / (packetsSent + packetsLost)) * 100;
      }

      callback({
        rtt,
        packetLoss,
        availableBandwidth,
        jitter,
      });
    } catch (error) {
      console.error('Failed to collect WebRTC stats:', error);
    }
  };

  const timer = setInterval(collectStats, interval);

  // Return cleanup function
  return () => clearInterval(timer);
}
