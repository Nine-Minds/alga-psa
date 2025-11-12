export interface InstallInfo {
  install_id: string;
  runner_domain: string | null;
  runner_status: any;
  tenant_id?: string;
  content_hash?: string | null;
}
