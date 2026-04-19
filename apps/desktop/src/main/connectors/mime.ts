const EXT_TO_MIME: Record<string, string> = {
  // Prose
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  rst: 'text/plain',
  // Docs / office
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // Source code
  ts: 'text/x-source',
  tsx: 'text/x-source',
  js: 'text/x-source',
  jsx: 'text/x-source',
  mjs: 'text/x-source',
  cjs: 'text/x-source',
  py: 'text/x-source',
  go: 'text/x-source',
  rs: 'text/x-source',
  java: 'text/x-source',
  kt: 'text/x-source',
  rb: 'text/x-source',
  php: 'text/x-source',
  c: 'text/x-source',
  cc: 'text/x-source',
  cpp: 'text/x-source',
  h: 'text/x-source',
  hpp: 'text/x-source',
  cs: 'text/x-source',
  swift: 'text/x-source',
  scala: 'text/x-source',
  // Shell / scripts
  sh: 'text/x-source',
  bash: 'text/x-source',
  zsh: 'text/x-source',
  fish: 'text/x-source',
  ps1: 'text/x-source',
  // Data / config
  sql: 'text/x-source',
  yaml: 'text/x-source',
  yml: 'text/x-source',
  toml: 'text/x-source',
  json: 'text/x-source',
  json5: 'text/x-source',
  jsonc: 'text/x-source',
  ini: 'text/x-source',
  conf: 'text/x-source',
  cfg: 'text/x-source',
  properties: 'text/x-source',
  env: 'text/x-source',
  xml: 'text/x-source',
  csv: 'text/x-source',
  tsv: 'text/x-source',
  // Web / frameworks
  vue: 'text/x-source',
  svelte: 'text/x-source',
  astro: 'text/x-source',
  html: 'text/x-source',
  htm: 'text/x-source',
  css: 'text/x-source',
  scss: 'text/x-source',
  sass: 'text/x-source',
  less: 'text/x-source',
  styl: 'text/x-source',
  graphql: 'text/x-source',
  gql: 'text/x-source',
  // Template engines
  twig: 'text/x-source',
  liquid: 'text/x-source',
  ejs: 'text/x-source',
  hbs: 'text/x-source',
  mustache: 'text/x-source',
  // Docs / infrastructure
  dockerfile: 'text/x-source',
  containerfile: 'text/x-source',
  makefile: 'text/x-source',
  cmake: 'text/x-source',
  tf: 'text/x-source',
  hcl: 'text/x-source',
  log: 'text/plain',
};

// Files without an extension we still want to index (match by basename).
const EXTENSIONLESS_BASENAMES: Record<string, string> = {
  Dockerfile: 'text/x-source',
  Containerfile: 'text/x-source',
  Makefile: 'text/x-source',
  Rakefile: 'text/x-source',
  Gemfile: 'text/x-source',
  Procfile: 'text/x-source',
  README: 'text/plain',
  LICENSE: 'text/plain',
  CHANGELOG: 'text/plain',
  NOTICE: 'text/plain',
};

export const SUPPORTED_EXTENSIONS = Object.keys(EXT_TO_MIME);

// Junk files created by OSes on non-native filesystems. These carry real file
// extensions (._Banner.php, ._report.pdf) but are resource-fork metadata, not
// real content. They'd otherwise pass mimeFromPath and get indexed.
const JUNK_FILE_PATTERNS = [
  /^\._/,              // macOS AppleDouble resource forks on FAT/exFAT drives
  /^\.DS_Store$/,      // macOS Finder metadata
  /^Thumbs\.db$/i,     // Windows thumbnail cache
  /^desktop\.ini$/i,   // Windows folder config
  /^\.localized$/,     // macOS folder locale marker
];

export function isJunkFile(path: string): boolean {
  const name = path.split(/[\\/]/).pop() ?? '';
  return JUNK_FILE_PATTERNS.some((re) => re.test(name));
}

export function mimeFromPath(path: string): string | null {
  if (isJunkFile(path)) return null;
  const base = path.split(/[\\/]/).pop() ?? '';
  // Exact-match basenames (Dockerfile, Makefile, README, …).
  if (EXTENSIONLESS_BASENAMES[base]) return EXTENSIONLESS_BASENAMES[base];
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return null; // no extension and not in the basename list
  const ext = base.slice(dot + 1).toLowerCase();
  return EXT_TO_MIME[ext] ?? null;
}

export function isSupported(path: string): boolean {
  return mimeFromPath(path) !== null;
}
