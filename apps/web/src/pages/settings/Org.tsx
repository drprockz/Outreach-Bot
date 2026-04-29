import { useEffect, useState } from 'react'
import { useQuery, useMutation, gql } from 'urql'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import PageHeader from '@/components/radar/PageHeader'

interface OrgQueryShape {
  org: { id: number; name: string; slug: string; status: string } | null
  members: { userId: number; email: string; role: 'owner' | 'admin' }[]
  me: { id: number; email: string } | null
}

const ORG_QUERY = gql`
  query OrgSettings {
    org { id name slug status }
    members { userId email role }
    me { id email }
  }
`

const UPDATE_ORG_MUTATION = gql`
  mutation UpdateOrg($name: String, $slug: String) {
    updateOrg(name: $name, slug: $slug) { id name slug status }
  }
`

export default function Org() {
  const [{ data, fetching, error }, refetch] = useQuery<OrgQueryShape>({ query: ORG_QUERY })
  const [, updateOrg] = useMutation(UPDATE_ORG_MUTATION)

  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [saving, setSaving] = useState(false)
  const [opError, setOpError] = useState('')
  const [opSuccess, setOpSuccess] = useState('')

  useEffect(() => {
    if (data?.org) {
      setName(data.org.name)
      setSlug(data.org.slug)
    }
  }, [data?.org?.id])

  const isOwner = data?.members?.some((m) => m.email === data.me?.email && m.role === 'owner') ?? false
  const dirty = data?.org ? (name !== data.org.name || slug !== data.org.slug) : false

  const handleSave = async () => {
    setOpError('')
    setOpSuccess('')
    if (!data?.org) return
    const args: { name?: string; slug?: string } = {}
    if (name !== data.org.name) args.name = name
    if (slug !== data.org.slug) args.slug = slug
    if (Object.keys(args).length === 0) return
    setSaving(true)
    try {
      const result = await updateOrg(args)
      if (result.error) {
        setOpError(result.error.graphQLErrors[0]?.message ?? result.error.message)
      } else {
        setOpSuccess('Saved')
        refetch({ requestPolicy: 'network-only' })
      }
    } finally {
      setSaving(false)
    }
  }

  if (fetching && !data) return <><PageHeader title="Workspace" subtitle="Organization settings" /><div style={{ color: 'var(--text-3)' }}>Loading organization…</div></>
  if (error) return <><PageHeader title="Workspace" subtitle="Organization settings" /><div style={{ color: 'var(--red)' }}>Error: {error.message}</div></>
  if (!data?.org) return <><PageHeader title="Workspace" subtitle="Organization settings" /><div style={{ color: 'var(--text-3)' }}>No organization found.</div></>

  return (
    <>
      <PageHeader title="Workspace" subtitle="Name and URL slug for your workspace" />
      <div style={{ maxWidth: 720 }}>
        <div style={{
          background: 'var(--bg-surface)',
          padding: 24,
          borderRadius: 10,
          border: '1px solid var(--border)',
          boxShadow: 'var(--shadow-sm)',
        }}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!isOwner}
              maxLength={80}
            />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Slug</label>
            <Input
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              disabled={!isOwner}
              maxLength={40}
            />
            <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>Lowercase letters, numbers, and dashes. 1–40 chars.</p>
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Status</label>
            <div style={{ fontSize: 14, textTransform: 'capitalize', color: 'var(--text-1)' }}>{data.org.status}</div>
          </div>
          {isOwner ? (
            <Button onClick={() => void handleSave()} disabled={saving || !dirty}>
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          ) : (
            <p style={{ fontSize: 14, color: 'var(--text-3)' }}>Only the org owner can edit these fields.</p>
          )}
          {opError && <p style={{ color: 'var(--red)', fontSize: 14, marginTop: 8 }}>{opError}</p>}
          {opSuccess && <p style={{ color: 'var(--green)', fontSize: 14, marginTop: 8 }}>{opSuccess}</p>}
        </div>
      </div>
    </>
  )
}
