// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { requireJsonContentType } from './http'

describe('requireJsonContentType', () => {
  it('returns null for application/json', () => {
    const req = new NextRequest('http://localhost:3000/api/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    })

    expect(requireJsonContentType(req)).toBeNull()
  })

  it('returns null for application/json with charset and mixed case', () => {
    const req = new NextRequest('http://localhost:3000/api/test', {
      method: 'POST',
      headers: { 'content-type': 'Application/JSON; Charset=utf-8' },
    })

    expect(requireJsonContentType(req)).toBeNull()
  })

  it('returns 415 for non-json content type', async () => {
    const req = new NextRequest('http://localhost:3000/api/test', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
    })

    const res = requireJsonContentType(req)
    expect(res).not.toBeNull()
    expect(res!.status).toBe(415)
    expect(await res!.json()).toEqual({
      error: 'content-type must be application/json',
    })
  })

  it('returns 415 when content type is missing', async () => {
    const req = new NextRequest('http://localhost:3000/api/test', {
      method: 'POST',
    })

    const res = requireJsonContentType(req)
    expect(res).not.toBeNull()
    expect(res!.status).toBe(415)
    expect(await res!.json()).toEqual({
      error: 'content-type must be application/json',
    })
  })
})
