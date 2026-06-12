/**
 * Build the per-language output path for multi-language API discovery: append
 * the language to the output base name while preserving its .json/.yaml/.yml
 * extension (e.g. "api-spec.yml" + "python" -> "api-spec_python.yml"). If the
 * path has no recognized extension, the language is appended with none.
 */
export function languageOutputPath(outputFile: string, lang: string): string {
  const ext = outputFile.match(/\.(json|yaml|yml)$/)?.[0] ?? '';
  return `${outputFile.replace(/\.(json|yaml|yml)$/, '')}_${lang}${ext}`;
}
