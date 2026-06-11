/**
 * Validate a nuclei template file path before it is read and uploaded. Rejects a
 * path containing a NUL byte and requires a .yaml/.yml extension, so a
 * non-template file is not read and uploaded by mistake. Throws on an invalid
 * path; returns normally when the path is acceptable.
 */
export function assertValidNucleiTemplatePath(filePath: string): void {
  if (filePath.includes('\0')) {
    throw new Error('Invalid template file path.');
  }
  if (!/\.ya?ml$/i.test(filePath)) {
    throw new Error('Nuclei template file must be a .yaml or .yml file.');
  }
}
