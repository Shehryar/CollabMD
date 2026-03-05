import Link from 'next/link'

function Logo() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      width="28"
      height="28"
      className="shrink-0"
    >
      <rect width="32" height="32" fill="#f7f7f5" rx="6" />
      <rect x="5" y="12.5" width="22" height="7" rx="1.5" fill="#c2682b" opacity="0.08" />
      <rect x="8" y="10" width="1.5" height="12" rx="0.75" fill="#c2682b" opacity="0.35" />
      <rect x="22.5" y="10" width="1.5" height="12" rx="0.75" fill="#c2682b" opacity="0.35" />
      <rect x="14.75" y="8" width="2.5" height="16" rx="1.25" fill="#c2682b" />
    </svg>
  )
}

function GitHubIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12Z" />
    </svg>
  )
}

const features = [
  {
    title: 'Real-time sync',
    description:
      'Conflict-free editing powered by CRDTs via Yjs. Multiple users, one document, zero merge issues.',
  },
  {
    title: 'Local-first',
    description:
      'A daemon watches your .md files on disk and syncs changes to the web editor automatically.',
  },
  {
    title: 'Comments & suggestions',
    description:
      'Inline comment threads with suggestion mode. Accept or dismiss proposed changes in one click.',
  },
  {
    title: 'Version history',
    description:
      'Automatic snapshots of every document. Browse, compare, and revert to any previous version.',
  },
  {
    title: 'Fine-grained permissions',
    description:
      'OpenFGA-based access control. Set per-document roles for owners, editors, and viewers.',
  },
  {
    title: 'Self-hosted',
    description:
      'Run the entire stack on your own infrastructure. SQLite for local dev, Postgres for production.',
  },
]

export function LandingHero() {
  return (
    <div className="min-h-screen bg-bg-subtle">
      {/* Nav */}
      <nav className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2.5">
          <Logo />
          <span className="font-mono text-[15px] font-semibold tracking-[-0.02em] text-fg">
            CollabMD
          </span>
        </div>
        <div className="flex items-center gap-4">
          <a
            href="https://github.com/collabmd/collabmd"
            target="_blank"
            rel="noopener noreferrer"
            className="text-fg-muted transition-colors hover:text-fg"
          >
            <GitHubIcon />
          </a>
          <Link
            href="/login"
            className="font-mono text-[12.5px] font-medium text-fg-secondary transition-colors hover:text-fg"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="rounded bg-accent px-4 py-[7px] font-mono text-[12.5px] font-medium text-white transition-colors hover:bg-accent-hover"
          >
            Get started
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="mx-auto max-w-5xl px-6 pb-16 pt-20 text-center sm:pt-28">
        <h1 className="font-mono text-[32px] font-semibold leading-tight tracking-[-0.03em] text-fg sm:text-[42px]">
          Collaborative markdown editing
        </h1>
        <p className="mx-auto mt-5 max-w-xl font-sans text-[15px] leading-relaxed text-fg-secondary">
          Local .md files, a web editor, and AI agents — all synced in real time via CRDTs.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link
            href="/signup"
            className="rounded bg-accent px-5 py-[9px] font-mono text-[12.5px] font-medium text-white transition-colors hover:bg-accent-hover"
          >
            Get started
          </Link>
          <a
            href="https://github.com/collabmd/collabmd"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded border border-border-strong bg-bg px-5 py-[9px] font-mono text-[12.5px] font-medium text-fg transition-colors hover:bg-bg-hover"
          >
            View on GitHub
          </a>
        </div>
      </section>

      {/* Terminal mockup */}
      <section className="mx-auto max-w-5xl px-6 pb-20">
        <div className="mx-auto max-w-lg overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900 shadow-lg">
          <div className="flex items-center gap-1.5 border-b border-neutral-800 px-4 py-3">
            <span className="h-2.5 w-2.5 rounded-full bg-neutral-700" />
            <span className="h-2.5 w-2.5 rounded-full bg-neutral-700" />
            <span className="h-2.5 w-2.5 rounded-full bg-neutral-700" />
          </div>
          <div className="px-5 py-4 font-mono text-[13px] leading-7 text-neutral-300">
            <div>
              <span className="text-accent">$</span> npx create-collabmd my-workspace
            </div>
            <div>
              <span className="text-accent">$</span> cd my-workspace
            </div>
            <div>
              <span className="text-accent">$</span> collabmd dev
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-5xl px-6 pb-24">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="rounded border border-border bg-white p-5 shadow-sm"
            >
              <h3 className="mb-2 font-mono text-[14px] font-semibold tracking-[-0.02em] text-fg">
                {feature.title}
              </h3>
              <p className="font-sans text-[13px] leading-relaxed text-fg-secondary">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border bg-bg-subtle">
        <div className="mx-auto flex max-w-5xl items-center justify-center gap-4 px-6 py-6 font-mono text-[11px] text-fg-muted">
          <span>MIT License</span>
          <span className="text-fg-faint">·</span>
          <a
            href="https://github.com/collabmd/collabmd"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-fg"
          >
            GitHub
          </a>
          <span className="text-fg-faint">·</span>
          <span>CollabMD</span>
        </div>
      </footer>
    </div>
  )
}
