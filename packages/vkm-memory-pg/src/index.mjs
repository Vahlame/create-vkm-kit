/**
 * Public surface of @vkmikc/vkm-memory-pg. Deep entry points also exist for consumers that
 * must not load the heavy modules: `./paths` and `./client` are the cheap ones.
 */
export {
  vaultSlug,
  pgHome,
  vaultPgDir,
  serviceInfoPath,
  tokenPath,
  lockPath,
  dataDirPath,
  readServiceInfo,
  readToken,
  lockAlive
} from "./pg-paths.mjs";
export { foldText, vecToSqlLiteral, b64ToFloat32 } from "./fold.mjs";
export { openAdapter } from "./pg-adapter.mjs";
export {
  ensureSchema,
  ensureVecColumn,
  metaGet,
  metaSet,
  installedPgliteVersion,
  SCHEMA_STATEMENTS,
  SCHEMA_VERSION
} from "./pg-schema.mjs";
export { syncFromDump, runDump, embedQuery } from "./pg-sync.mjs";
export { graphHops, fullGraph } from "./graph-query.mjs";
export { isValidScope, pathInScope, scopeMatchSql } from "./scope.mjs";
export {
  serviceUrlFor,
  pgFetch,
  ensureServiceRunning,
  PgServiceUnavailableError
} from "./pg-http-client.mjs";
export {
  createService,
  resolveVaultFromEnv,
  formatSseEvent,
  AlreadyRunningError
} from "./pg-service.mjs";
export {
  runMigrate,
  enrichPass,
  validateEnrichment,
  renderReport,
  defaultOllama,
  ENRICH_JSON_SCHEMA
} from "./migrate.mjs";
