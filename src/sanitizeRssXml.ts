/** True when the body looks like RSS/RDF/Atom XML, not an HTML error page. */
export function looksLikeFeedXml(text: string): boolean {
  const head = text.trimStart().slice(0, 800).toLowerCase();
  if (head.startsWith("<!doctype") || head.startsWith("<html")) {
    return false;
  }
  return (
    head.startsWith("<?xml") ||
    head.includes("<rss") ||
    head.includes("<rdf:rdf") ||
    head.includes("<feed")
  );
}

/** Best-effort fixes for publisher feeds that break strict XML parsers (e.g. AAAS). */
export function repairRssXml(xml: string): string {
  let repaired = xml.replace(/<prism:([\w]+)\s*\/>/gi, "<prism:$1></prism:$1>");
  // Unquoted or empty attributes in embedded HTML (common in AAAS item bodies).
  repaired = repaired.replace(/(\s)([\w:-]+)=\s*(\/|>)/g, '$1$2=""$3');
  return repaired;
}
