/** Shared CLI helpers for llm-probe scripts. */

export function argValue(argv: string[], name: string): string | undefined {
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(`--${name}=`.length);
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** Positional args only — skip `--flag` and the value that follows value-taking flags. */
export function positionalArgs(argv: string[], valueFlags: string[] = ["grep", "base-url", "model", "date", "file", "limit"]): string[] {
  const valueFlagSet = new Set(valueFlags);
  const out: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const name = a.slice(2).split("=")[0]!;
      if (!a.includes("=") && valueFlagSet.has(name)) i += 1;
      continue;
    }
    out.push(a);
  }
  return out;
}

export function matchesGrep(id: string, grep: string): boolean {
  const needles = grep
    .split(/[,|]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (needles.length === 0) return true;
  const hay = id.toLowerCase();
  return needles.some((n) => hay.includes(n));
}
