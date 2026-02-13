'use client'

import { useEffect } from 'react'

export function WebMcpProvider() {
  useEffect(() => {
    import('@/lib/webmcp-dev-tools').then(({ registerDevTools }) => {
      registerDevTools()
    })
  }, [])

  return null
}
