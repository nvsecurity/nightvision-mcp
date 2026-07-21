import os from 'os';

const MAX_TARGET_NAME_LENGTH = 100;

function targetNamePart(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'app';
}

export function localTargetName(repoName: string, appName?: string): string {
  const safeBase = targetNamePart(appName || repoName || 'app');
  const safeUser = targetNamePart(os.userInfo().username);
  return `${safeBase}-local-${safeUser}`.slice(0, MAX_TARGET_NAME_LENGTH).replace(/-$/g, '');
}
