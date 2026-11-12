export const POLICY_VERSION = "2026-10-12";
export const MINIMUM_AGE = 16;
export const legalConfig = {
  publicLaunch: process.env.NUDGE_PUBLIC_LAUNCH === "true",
  operator: process.env.NUDGE_OPERATOR_NAME?.trim() ?? "",
  country: process.env.NUDGE_OPERATOR_COUNTRY?.trim() ?? "",
  address: process.env.NUDGE_OPERATOR_ADDRESS?.trim() ?? "",
  email: process.env.NUDGE_CONTACT_EMAIL?.trim() ?? "",
  host: process.env.NUDGE_HOSTING_PROVIDER?.trim() ?? "",
  dataRegion: process.env.NUDGE_DATA_REGION?.trim() ?? "",
  transfers: process.env.NUDGE_TRANSFER_SAFEGUARDS?.trim() ?? "",
  backupDays: process.env.NUDGE_BACKUP_RETENTION_DAYS?.trim() ?? "",
  logDays: process.env.NUDGE_LOG_RETENTION_DAYS?.trim() ?? "",
  aiVendor: process.env.NUDGE_AI_VENDOR?.trim() ?? "",
  aiPrivacyUrl: process.env.NUDGE_AI_PRIVACY_URL?.trim() ?? "",
};
export const operatorConfigured = Boolean(legalConfig.operator && legalConfig.country && legalConfig.address && legalConfig.email);
