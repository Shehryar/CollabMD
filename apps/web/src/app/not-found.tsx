import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-subtle">
      <div className="text-center">
        <h1 className="font-mono text-6xl font-bold text-fg">404</h1>
        <p className="mt-4 font-sans text-fg-secondary">This page doesn&apos;t exist.</p>
        <Link
          href="/"
          className="mt-8 inline-block rounded bg-accent px-6 py-2 font-sans text-sm text-white transition-colors hover:bg-accent/90"
        >
          Go home
        </Link>
      </div>
    </div>
  )
}
