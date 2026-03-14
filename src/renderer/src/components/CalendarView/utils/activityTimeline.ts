import type { ActivityEvent } from '../types'
import { mergeAdjacentBlocks, type TimeBlock } from './blocks'
import { MINUTE_MS } from './constants'

interface ActivitySegment extends TimeBlock {
  app: string
  appKey: string
}

interface MinuteWinner extends TimeBlock {
  app: string
  appKey: string
}

function parseTimestamp(timestamp: string): number | null {
  const parsed = Date.parse(timestamp)
  return Number.isNaN(parsed) ? null : parsed
}

function buildSegment(event: ActivityEvent, nextEvent: ActivityEvent | undefined): ActivitySegment | null {
  const startMs = parseTimestamp(event.timestamp)
  if (startMs === null) return null

  const nextStartMs = nextEvent ? parseTimestamp(nextEvent.timestamp) : null
  const fallbackEndMs = startMs + Math.max(0, event.duration) * 1000
  const endMs = nextStartMs ?? fallbackEndMs
  if (endMs <= startMs) return null

  const app = event.data.app.trim() || 'Unknown'
  return { startMs, endMs, app, appKey: app.toLowerCase() }
}

function toSortedSegments(events: ActivityEvent[]): ActivitySegment[] {
  if (events.length === 0) return []

  const sorted = [...events].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))

  return sorted
    .map((event, index) => buildSegment(event, sorted[index + 1]))
    .filter((segment): segment is ActivitySegment => segment !== null)
}

function getMinuteContribution(
  segment: ActivitySegment,
  bucketStartMs: number,
  bucketEndMs: number
): number {
  if (segment.startMs >= bucketEndMs || segment.endMs <= bucketStartMs) return 0
  return Math.min(segment.endMs, bucketEndMs) - Math.max(segment.startMs, bucketStartMs)
}

function pickMinuteWinner(segments: ActivitySegment[], bucketStartMs: number): MinuteWinner | null {
  const bucketEndMs = bucketStartMs + MINUTE_MS
  const totals = new Map<string, { app: string; totalMs: number }>()

  for (const segment of segments) {
    const contributionMs = getMinuteContribution(segment, bucketStartMs, bucketEndMs)
    if (contributionMs <= 0) continue

    const existing = totals.get(segment.appKey)
    if (existing) {
      existing.totalMs += contributionMs
      continue
    }

    totals.set(segment.appKey, { app: segment.app, totalMs: contributionMs })
  }

  if (totals.size === 0) return null

  let bestKey = ''
  let bestApp = ''
  let bestTotalMs = -1

  for (const [appKey, value] of totals.entries()) {
    const isBetter =
      value.totalMs > bestTotalMs || (value.totalMs === bestTotalMs && value.app.localeCompare(bestApp) < 0)

    if (!isBetter) continue
    bestKey = appKey
    bestApp = value.app
    bestTotalMs = value.totalMs
  }

  if (!bestKey) return null
  return { startMs: bucketStartMs, endMs: bucketEndMs, app: bestApp, appKey: bestKey }
}

function toMinuteWinners(segments: ActivitySegment[], nowMs: number): MinuteWinner[] {
  if (segments.length === 0) return []

  const completedBoundaryMs = Math.floor(nowMs / MINUTE_MS) * MINUTE_MS
  const firstBucketMs = Math.floor(segments[0].startMs / MINUTE_MS) * MINUTE_MS
  const lastBucketLimitMs = Math.min(
    completedBoundaryMs,
    Math.ceil(segments[segments.length - 1].endMs / MINUTE_MS) * MINUTE_MS
  )
  if (lastBucketLimitMs <= firstBucketMs) return []

  const winners: MinuteWinner[] = []
  for (let bucketStartMs = firstBucketMs; bucketStartMs < lastBucketLimitMs; bucketStartMs += MINUTE_MS) {
    const winner = pickMinuteWinner(segments, bucketStartMs)
    if (winner) winners.push(winner)
  }

  return winners
}

export function buildActivityMinuteBlocks(events: ActivityEvent[], nowMs: number): MinuteWinner[] {
  const segments = toSortedSegments(events)
  const winners = toMinuteWinners(segments, nowMs)
  return mergeAdjacentBlocks(winners, (left, right) => left.appKey === right.appKey)
}
