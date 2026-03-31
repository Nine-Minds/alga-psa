import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink, mkdtemp } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import type { TrialConfig } from './types';
import type { TrialSecrets } from './secrets';

const execFileAsync = promisify(execFile);

interface HelmInstallOptions {
  releaseName: string;
  namespace: string;
  chartPath: string;
  trialId: string;
  host: string;
  config: TrialConfig;
  secrets: TrialSecrets;
}

/**
 * Build a Helm values override file for a trial deployment.
 */
function buildValuesOverride(options: HelmInstallOptions): Record<string, unknown> {
  const { namespace, host, config, secrets } = options;

  return {
    namespace,
    nameOverride: options.releaseName,
    host,

    bootstrap: {
      mode: 'fresh',
    },

    istio: {
      enabled: config.istioEnabled,
      ...(config.istioEnabled
        ? {
            hosts: [host],
            routes: {
              default: {
                host,
                service: options.releaseName,
                port: 3000,
              },
            },
          }
        : {}),
    },

    setup: {
      image: {
        name: config.setupImage,
        is_private: false,
        tag: config.setupImageTag,
      },
      pullPolicy: 'IfNotPresent',
      runMigrations: true,
      runSeeds: true,
      applianceBootstrap: {
        enabled: false,
      },
    },

    server: {
      image: {
        name: config.serverImage,
        is_private: false,
        tag: config.serverImageTag,
      },
      pullPolicy: 'IfNotPresent',
      replicaCount: 1,
      hostNetwork: false,
      verify_email: false,
      service: {
        type: 'ClusterIP',
        port: 3000,
      },
      persistence: {
        enabled: true,
        size: '5Gi',
        storageClass: config.storageClass,
      },
    },

    hocuspocus: {
      enabled: false,
    },

    db: {
      enabled: true,
      image: {
        repository: 'ankane/pgvector',
        tag: 'latest',
      },
      service: {
        port: 5432,
      },
      persistence: {
        enabled: true,
        size: '5Gi',
        storageClass: config.storageClass,
      },
    },

    redis: {
      enabled: true,
      image: {
        repository: 'redis',
        tag: 'latest',
      },
      service: {
        port: 6379,
      },
      persistence: {
        enabled: false,
      },
    },

    pgbouncer: {
      enabled: false,
    },

    persistence: {
      enabled: true,
      storageClass: config.storageClass,
      size: '5Gi',
      keepPvcOnUninstall: false,
    },

    config: {
      db: {
        type: 'postgres',
        host: 'db',
        port: 5432,
        user: 'postgres',
        password: secrets.postgresPassword,
        server_database: 'server',
        hocuspocus_database: 'hocuspocus',
      },
      redis: {
        host: 'redis',
        port: 6379,
        password: secrets.redisPassword,
        db: 0,
      },
      storage: {
        default_provider: 'local',
        providers: {
          local: {
            enabled: true,
            base_path: '/data/files',
            max_file_size: 104857600,
            allowed_mime_types: ['*/*'],
            retention_days: 30,
          },
          s3: {
            enabled: false,
          },
        },
      },
    },

    crypto: {
      salt_bytes: 12,
      iteration: 1000,
      key_length: 64,
      algorithm: 'sha512',
    },

    token: {
      expires: '1h',
    },

    auth: {
      nextauth_session_expires: 86400,
    },

    email: {
      enabled: false,
    },

    logging: {
      level: 'INFO',
      is_format_json: false,
      is_full_details: false,
      file: {
        enabled: false,
      },
      external: {
        enabled: false,
      },
    },

    secrets_provider: {
      readChain: 'env,filesystem',
      writeProvider: 'filesystem',
    },
  };
}

/**
 * Install a Helm release for a trial instance.
 */
export async function helmInstall(options: HelmInstallOptions): Promise<{ stdout: string; stderr: string }> {
  const values = buildValuesOverride(options);

  // Write values to a temp file
  const tmpDir = await mkdtemp(join(tmpdir(), 'trial-helm-'));
  const valuesPath = join(tmpDir, 'values.yaml');

  // Convert to YAML manually (avoid adding js-yaml dependency)
  const yaml = jsonToYaml(values);
  await writeFile(valuesPath, yaml, 'utf-8');

  try {
    const args = [
      'upgrade',
      '--install',
      options.releaseName,
      options.chartPath,
      '--namespace', options.namespace,
      '--values', valuesPath,
      '--wait',
      '--timeout', '10m',
      '--create-namespace',
    ];

    const result = await execFileAsync('helm', args, {
      timeout: 660_000, // 11 min (slightly longer than helm --timeout)
    });

    return result;
  } finally {
    await unlink(valuesPath).catch(() => {});
  }
}

/**
 * Uninstall a Helm release.
 */
export async function helmUninstall(releaseName: string, namespace: string): Promise<void> {
  await execFileAsync('helm', [
    'uninstall', releaseName,
    '--namespace', namespace,
  ], { timeout: 120_000 });
}

/**
 * Minimal JSON-to-YAML converter (handles nested objects, arrays, strings, numbers, booleans).
 */
function jsonToYaml(obj: unknown, indent: number = 0): string {
  const prefix = '  '.repeat(indent);

  if (obj === null || obj === undefined) return `${prefix}null\n`;
  if (typeof obj === 'boolean') return `${obj}`;
  if (typeof obj === 'number') return `${obj}`;
  if (typeof obj === 'string') {
    // Quote strings that could be ambiguous
    if (obj === '' || obj.includes(':') || obj.includes('#') || obj.includes("'") || obj.includes('"') || obj.includes('\n') || /^[{[\]},>|*&!%@`]/.test(obj)) {
      return `"${obj.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]';
    return obj.map(item => {
      if (typeof item === 'object' && item !== null) {
        const inner = jsonToYaml(item, indent + 1).trimStart();
        return `${prefix}- ${inner}`;
      }
      return `${prefix}- ${jsonToYaml(item, 0)}`;
    }).join('\n');
  }

  if (typeof obj === 'object') {
    const entries = Object.entries(obj as Record<string, unknown>);
    if (entries.length === 0) return `${prefix}{}`;

    return entries.map(([key, value]) => {
      if (value === null || value === undefined) {
        return `${prefix}${key}: null`;
      }
      if (typeof value === 'object' && !Array.isArray(value)) {
        const inner = jsonToYaml(value, indent + 1);
        return `${prefix}${key}:\n${inner}`;
      }
      if (Array.isArray(value)) {
        if (value.length === 0) return `${prefix}${key}: []`;
        const inner = jsonToYaml(value, indent + 1);
        return `${prefix}${key}:\n${inner}`;
      }
      return `${prefix}${key}: ${jsonToYaml(value, 0)}`;
    }).join('\n');
  }

  return `${obj}`;
}
