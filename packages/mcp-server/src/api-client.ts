export interface DocumentSummary {
  id: string
  title: string
  folderId: string | null
  createdAt: string
  updatedAt: string
}

export interface CommentThreadEntry {
  authorId: string
  authorName: string
  text: string
  createdAt: string
}

export interface Suggestion {
  originalText: string
  proposedText: string
  status: string
}

export interface Comment {
  id: string
  authorId: string
  authorName: string
  source: string
  text: string
  createdAt: string
  resolved: boolean
  thread: CommentThreadEntry[]
  suggestion?: Suggestion
}

export interface DiscussionAuthor {
  userId: string
  name: string
}

export interface DiscussionReply {
  author: DiscussionAuthor
  text: string
  createdAt: string
}

export interface Discussion {
  id: string
  author: DiscussionAuthor
  title: string
  text: string
  createdAt: string
  resolved: boolean
  thread: DiscussionReply[]
}

export interface PendingMention {
  documentId: string
  documentTitle: string
  commentId: string
  commentText: string
  anchorText: string
  surroundingContext: string
}

interface JsonRequestInit extends RequestInit {
  body?: string
}

const DEFAULT_DOCUMENT_PAGE_SIZE = 100
const MCP_USER_AGENT = '@collabmd/mcp-server/0.1.0'

export class CollabMDClient {
  private readonly serverUrl: string
  private readonly apiKey: string

  constructor(serverUrl: string, apiKey: string) {
    this.serverUrl = serverUrl.replace(/\/+$/, '')
    this.apiKey = apiKey
  }

  async listDocuments(): Promise<DocumentSummary[]> {
    const all: DocumentSummary[] = []
    let offset = 0

    while (true) {
      const page = await this.requestJson<DocumentSummary[]>(
        `/api/v1/documents?limit=${DEFAULT_DOCUMENT_PAGE_SIZE}&offset=${offset}`,
      )
      all.push(...page)

      if (page.length < DEFAULT_DOCUMENT_PAGE_SIZE) break
      offset += page.length
    }

    return all
  }

  async readDocument(id: string): Promise<{ documentId: string; content: string }> {
    return this.requestJson<{ documentId: string; content: string }>(
      `/api/v1/documents/${encodeURIComponent(id)}/content`,
    )
  }

  async writeDocument(id: string, content: string): Promise<void> {
    await this.requestJson(`/api/v1/documents/${encodeURIComponent(id)}/content`, {
      method: 'PATCH',
      body: JSON.stringify({ content }),
    })
  }

  async listComments(id: string): Promise<Comment[]> {
    return this.requestJson<Comment[]>(`/api/v1/documents/${encodeURIComponent(id)}/comments`)
  }

  async addComment(id: string, text: string, anchorText?: string): Promise<void> {
    const range = await this.resolveCommentRange(id, anchorText)
    await this.requestJson(`/api/v1/documents/${encodeURIComponent(id)}/comments`, {
      method: 'POST',
      body: JSON.stringify({
        text,
        from: range.from,
        to: range.to,
      }),
    })
  }

  async listDiscussions(id: string): Promise<Discussion[]> {
    return this.requestJson<Discussion[]>(`/api/v1/documents/${encodeURIComponent(id)}/discussions`)
  }

  async addDiscussion(id: string, title: string, text: string): Promise<void> {
    await this.requestJson(`/api/v1/documents/${encodeURIComponent(id)}/discussions`, {
      method: 'POST',
      body: JSON.stringify({ title, text }),
    })
  }

  async suggestEdit(
    id: string,
    anchorText: string,
    proposedText: string,
    note?: string,
  ): Promise<void> {
    await this.requestJson(`/api/v1/documents/${encodeURIComponent(id)}/suggestions`, {
      method: 'POST',
      body: JSON.stringify({ anchorText, proposedText, note }),
    })
  }

  async getPendingMentions(documentId?: string): Promise<PendingMention[]> {
    const params = documentId ? `?documentId=${encodeURIComponent(documentId)}` : ''
    return this.requestJson<PendingMention[]>(`/api/v1/mentions/pending${params}`)
  }

  private async resolveCommentRange(
    documentId: string,
    anchorText?: string,
  ): Promise<{ from: number; to: number }> {
    const target = typeof anchorText === 'string' ? anchorText.trim() : ''
    const content = (await this.readDocument(documentId)).content

    if (target.length > 0) {
      const matches: number[] = []
      let searchFrom = 0

      while (searchFrom < content.length) {
        const index = content.indexOf(target, searchFrom)
        if (index < 0) break
        matches.push(index)
        searchFrom = index + target.length
      }

      if (matches.length === 0) {
        throw new Error(`anchor text not found in document: "${target}"`)
      }
      if (matches.length > 1) {
        throw new Error(`anchor text is ambiguous (${matches.length} matches): "${target}"`)
      }
      const index = matches[0] as number
      return { from: index, to: index + target.length }
    }

    if (content.length === 0) {
      throw new Error('cannot add an anchored comment to an empty document without anchorText')
    }

    return { from: 0, to: 1 }
  }

  private async requestJson<T = unknown>(path: string, init?: JsonRequestInit): Promise<T> {
    const response = await fetch(`${this.serverUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
        'user-agent': MCP_USER_AGENT,
        ...(init?.headers ?? {}),
      },
    })

    if (!response.ok) {
      let details = ''
      try {
        const parsed = (await response.json()) as { error?: unknown }
        if (typeof parsed.error === 'string') details = parsed.error
      } catch {
        // ignore parse errors and fall back to status text
      }
      const suffix = details ? `: ${details}` : ''
      throw new Error(`CollabMD API request failed (${response.status})${suffix}`)
    }

    const emptyResponse = response.status === 204 || response.headers.get('content-length') === '0'
    if (emptyResponse) return undefined as T

    return (await response.json()) as T
  }
}
