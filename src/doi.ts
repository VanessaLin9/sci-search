const DOI_PATTERN = /\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/i;

export function extractDoi(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.match(DOI_PATTERN)?.[0];
}
