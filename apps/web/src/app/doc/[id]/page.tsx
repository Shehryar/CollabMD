'use client'

import { use } from 'react'
import { CollabEditor, useYjs } from '@/components/editor'

interface DocPageProps {
  params: Promise<{ id: string }>
}

export default function DocPage({ params }: DocPageProps) {
  const { id } = use(params)
  const yjs = useYjs(id)

  return (
    <div className="flex h-screen flex-col bg-white">
      <header className="flex h-12 shrink-0 items-center border-b border-gray-200 px-4">
        <h1 className="text-sm font-medium text-gray-700">
          CollabMD
        </h1>
        <span className="mx-2 text-gray-300">/</span>
        <span className="text-sm text-gray-500 font-mono">{id}</span>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-gray-400">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${yjs.synced ? 'bg-green-400' : 'bg-yellow-400 animate-pulse'}`}
          />
          {yjs.synced ? 'synced' : 'connecting'}
        </span>
      </header>
      <main className="min-h-0 flex-1">
        <CollabEditor yjs={yjs} />
      </main>
    </div>
  )
}
