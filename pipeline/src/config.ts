import * as dotenv from 'dotenv';
import { readFileSync } from 'fs';
import * as path from 'path';
import type { IndexerConfig } from './types';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

/**
 * Current schema version understood by this build of the indexer.
 *
 * Bump this whenever the derived-state schema changes in a way that requires
 * a migration. The version is persisted inside the database itself (see
 * pipeline/src/db.ts) so an existing database can be upgraded in place.
 *
 * Policy for breaking schema changes:
 *   - Additive / in-place changes MUST ship a forward migration so operators
 *     upgrade without re-indexing.
 *   - A change that cannot be migrated forward (e.g. a destructive reshape of
 *     derived state) MUST bump SCHEMA_VERSION and set
 *     SCHEMA_REQUIRES_REINDEX = true. The indexer will then refuse to start
 *     against an older database with a clear error instead of silently
 *     re-indexing, making the re-index an explicit operator decision.
 */
export const SCHEMA_VERSION = 1;

/**
 * When true, a database at an older schema version cannot be migrated forward
 * and the operator must re-index from scratch. This is surfaced as an explicit
 * startup refusal rather than an implicit wipe.
 */
export const SCHEMA_REQUIRES_REINDEX = false;

function loadDeployment(): { contract_id?: string; admin_address?: string; contracts?: { wrap?: { contract_id?: string; admin_address?: string } } } | null {
  const manifestPath = path.resolve(
    process.env.DEPLOYMENT_MANIFEST || path.resolve(__dirname, '../../deployments/manifest.json'),
  );
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(`Unable to read deployment manifest at ${manifestPath}: ${(error as Error).message}`);
  }
}

export function loadConfig(): IndexerConfig {
  const deployment = process.env.CONTRACT_ID ? null : loadDeployment();
  const contractId = process.env.CONTRACT_ID
    || deployment?.contracts?.wrap?.contract_id
    || deployment?.contract_id
    || '';
  if (!contractId) {
    throw new Error(
      'CONTRACT_ID environment variable is required. ' +
      'Set it in pipeline/.env, export CONTRACT_ID=..., or provide deployments/manifest.json.'
    );
  }

  return {
    rpc_url: process.env.RPC_URL || 'https://soroban-testnet.stellar.org',
    contract_id: contractId,
    db_path: process.env.DB_PATH || path.resolve(__dirname, '../indexer.db'),
    poll_interval_ms: parseInt(process.env.POLL_INTERVAL_MS || '5000', 10),
    event_page_size: parseInt(process.env.EVENT_PAGE_SIZE || '100', 10),
    // START_LEDGER is a first-run default only: once a cursor has been
    // persisted, the indexer resumes from it and ignores this value.
    start_ledger: parseInt(process.env.START_LEDGER || '1', 10),
    backfill: process.argv.includes('--backfill'),
    reconcile_only: process.argv.includes('--reconcile-only'),
    alert_webhook_url: process.env.ALERT_WEBHOOK_URL || '',
    alert_min_severity: (process.env.ALERT_MIN_SEVERITY || 'warning') as IndexerConfig['alert_min_severity'],
    expected_admin: process.env.EXPECTED_ADMIN || deployment?.contracts?.wrap?.admin_address || deployment?.admin_address || '',
  };
}
