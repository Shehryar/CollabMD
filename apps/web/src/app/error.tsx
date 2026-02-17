'use client'

import { useEffect } from 'react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-subtle">
      <div className="text-center">
        <h1 className="font-mono text-4xl font-bold text-fg">Something went wrong</h1>
        <p className="mt-4 font-sans text-fg-secondary">An unexpected error occurred.</p>
        <button
          onClick={reset}
          className="mt-8 rounded bg-accent px-6 py-2 font-sans text-sm text-white transition-colors hover:bg-accent/90"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
