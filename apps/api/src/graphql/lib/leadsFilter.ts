// Lead query filter parser. Ported from src/api/routes/leads/filterParser.js.
// apps/api's tsconfig rootDir forbids cross-imports into legacy src/, and the
// shape is small + stable. The legacy copy stays until Phase 10 decommission.

import { Prisma } from '@prisma/client'

export interface Thresholds {
  threshA: number
  threshB: number
}

export interface LeadFilterInput {
  search?: string | null
  status?: string[] | null
  category?: string[] | null
  city?: string[] | null
  country?: string[] | null
  emailStatus?: string[] | null
  businessStage?: string[] | null
  employeesEstimate?: string[] | null
  icpPriority?: string[] | null
  icpScoreMin?: number | null
  icpScoreMax?: number | null
  qualityScoreMin?: number | null
  qualityScoreMax?: number | null
  hasLinkedinDm?: boolean | null
  // 'all' (show both) | 'only' (only rejected) | omitted/false (default — hide rejected)
  inRejectList?: string | null
  dateFrom?: string | null
  dateTo?: string | null
  techStack?: string[] | null
  businessSignals?: string[] | null
  hasSignals?: boolean | null
  minSignalCount?: number | null
  signalType?: string[] | null
  signalDateFrom?: string | null
  signalDateTo?: string | null
}

export interface SignalFilter {
  has?: boolean
  minCount?: number
  types?: string[]
  from?: Date
  to?: Date
}

const SORT_ALLOWLIST: Record<string, string> = {
  icp_score: 'icpScore',
  website_quality_score: 'websiteQualityScore',
  // signal_count sort is deferred — falls through to the default ordering
  signal_count: '__signalCount',
  discovered_at: 'discoveredAt',
  domain_last_contacted: 'domainLastContacted',
}

function priorityToRange(p: string, t: Thresholds): { gte?: number; lt?: number } | null {
  if (p === 'A') return { gte: t.threshA }
  if (p === 'B') return { gte: t.threshB, lt: t.threshA }
  if (p === 'C') return { lt: t.threshB }
  return null
}

export function parseSort(s: string | null | undefined): Prisma.LeadOrderByWithRelationInput[] {
  const fallback: Prisma.LeadOrderByWithRelationInput[] = [
    { icpScore: 'desc' },
    { discoveredAt: 'desc' },
  ]
  if (!s) return fallback
  const [field, dir] = s.split(':')
  if (!SORT_ALLOWLIST[field] || (dir !== 'asc' && dir !== 'desc')) return fallback
  if (SORT_ALLOWLIST[field] === '__signalCount') return fallback
  return [
    { [SORT_ALLOWLIST[field]]: dir } as Prisma.LeadOrderByWithRelationInput,
    { discoveredAt: 'desc' },
  ]
}

export interface ParsedLeadQuery {
  where: Prisma.LeadWhereInput
  orderBy: Prisma.LeadOrderByWithRelationInput[]
  signalFilter: SignalFilter
}

function multi(field: keyof Prisma.LeadWhereInput, values: string[] | null | undefined, where: Prisma.LeadWhereInput): void {
  if (!values || values.length === 0) return
  if (values.length === 1) {
    ;(where as Record<string, unknown>)[field as string] = values[0]
  } else {
    ;(where as Record<string, unknown>)[field as string] = { in: values }
  }
}

export function parseLeadFilter(filter: LeadFilterInput | null | undefined, t: Thresholds, sort: string | null | undefined): ParsedLeadQuery {
  const f: LeadFilterInput = filter ?? {}
  const where: Prisma.LeadWhereInput = {}

  multi('status', f.status, where)
  multi('category', f.category, where)
  multi('city', f.city, where)
  multi('country', f.country, where)
  multi('emailStatus', f.emailStatus, where)
  multi('businessStage', f.businessStage, where)
  multi('employeesEstimate', f.employeesEstimate, where)

  if (f.search) {
    where.AND = ([] as Prisma.LeadWhereInput[]).concat(where.AND ?? [], [{
      OR: [
        { businessName: { contains: f.search, mode: 'insensitive' } },
        { websiteUrl: { contains: f.search, mode: 'insensitive' } },
        { contactEmail: { contains: f.search, mode: 'insensitive' } },
      ],
    }])
  }

  const priorities = f.icpPriority ?? []
  if (priorities.length === 1) {
    const r = priorityToRange(priorities[0], t)
    if (r) where.icpScore = r
  } else if (priorities.length > 1) {
    const ors = priorities
      .map((p) => priorityToRange(p, t))
      .filter((r): r is { gte?: number; lt?: number } => r !== null)
      .map((r) => ({ icpScore: r }))
    if (ors.length) where.AND = ([] as Prisma.LeadWhereInput[]).concat(where.AND ?? [], [{ OR: ors }])
  }

  if (f.icpScoreMin !== null && f.icpScoreMin !== undefined) {
    where.icpScore = { ...((where.icpScore as object) ?? {}), gte: f.icpScoreMin }
  }
  if (f.icpScoreMax !== null && f.icpScoreMax !== undefined) {
    where.icpScore = { ...((where.icpScore as object) ?? {}), lte: f.icpScoreMax }
  }

  if (f.qualityScoreMin !== null && f.qualityScoreMin !== undefined) {
    where.websiteQualityScore = { ...((where.websiteQualityScore as object) ?? {}), gte: f.qualityScoreMin }
  }
  if (f.qualityScoreMax !== null && f.qualityScoreMax !== undefined) {
    where.websiteQualityScore = { ...((where.websiteQualityScore as object) ?? {}), lte: f.qualityScoreMax }
  }

  if (f.hasLinkedinDm) where.dmLinkedinUrl = { not: null }

  // in_reject_list — default hides rejected rows
  if (f.inRejectList === 'only' || f.inRejectList === '1' || f.inRejectList === 'true') {
    where.inRejectList = true
  } else if (f.inRejectList !== 'all') {
    where.inRejectList = false
  }

  if (f.dateFrom || f.dateTo) {
    const range: { gte?: Date; lte?: Date } = {}
    if (f.dateFrom) range.gte = new Date(f.dateFrom)
    if (f.dateTo) range.lte = new Date(f.dateTo)
    where.discoveredAt = range
  }

  const signalFilter: SignalFilter = {}
  if (f.hasSignals) signalFilter.has = true
  if (f.minSignalCount) signalFilter.minCount = f.minSignalCount
  if (f.signalType && f.signalType.length) signalFilter.types = f.signalType
  if (f.signalDateFrom) signalFilter.from = new Date(f.signalDateFrom)
  if (f.signalDateTo) signalFilter.to = new Date(f.signalDateTo)

  return { where, orderBy: parseSort(sort), signalFilter }
}

export function bucket(score: number, threshA: number, threshB: number): 'high' | 'medium' | 'low' {
  if (score >= threshA) return 'high'
  if (score >= threshB) return 'medium'
  return 'low'
}
