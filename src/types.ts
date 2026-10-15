export type TargetType = 'local' | 'sftp' | 'github';
export type SftpAuthMethod = 'password' | 'privateKey' | 'sshAgent' | 'sshConfig';

export interface SftpTarget {
  host: string;
  port: number;
  username: string;
  authMethod?: SftpAuthMethod;
  password?: string;
  privateKey?: string;
  agentSocket?: string;
  remotePath: string;
}

export interface GithubTarget {
  token?: string;
  owner: string;
  repository: string;
  branch: string;
  pathPrefix?: string;
}

export interface TargetProfile {
  id: string;
  name: string;
  type: Exclude<TargetType, 'local'>;
  publicUrl: string;
  sftp?: SftpTarget;
  github?: GithubTarget;
}

export interface PublicTargetProfile {
  id: string;
  name: string;
  type: Exclude<TargetType, 'local'>;
  publicUrl: string;
  hasSecret: boolean;
  destination: string;
}

export interface LocalSite {
  id: string;
  name?: string;
  domain?: string;
  path?: string;
  ports?: {
    HTTP?: number;
    HTTPS?: number;
  };
  [key: string]: unknown;
}

export interface ExportOptions {
  sourceUrl?: string;
  publicUrl?: string;
  maxPages?: number;
  includeSitemap?: boolean;
  localBuild?: boolean;
}

export interface ExportProgress {
  phase: 'starting' | 'crawling' | 'writing' | 'uploading' | 'complete' | 'cancelled' | 'error';
  message: string;
  current?: number;
  total?: number;
  outputDir?: string;
  pages?: number;
  assets?: number;
  limitReached?: boolean;
  pendingPages?: number;
  commitUrl?: string;
}

export interface ExportResult {
  outputDir: string;
  pages: number;
  assets: number;
  warnings: string[];
  limitReached?: boolean;
  pendingPages?: number;
  commitUrl?: string;
}
