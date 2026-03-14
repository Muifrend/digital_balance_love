import type { ClassificationEntry } from '../types'
import { mergeAdjacentBlocks, type TimeBlock } from './blocks'
import {
  CLASSIFICATION_ATTRIBUTION_OFFSET_MS,
  CLASSIFICATION_CARRY_FORWARD_MS,
  MINUTE_MS
} from './constants'

interface MinuteClassification extends TimeBlock {
  onGoal: boolean
}

interface MinuteState {
  onGoal: boolean
  timestampMs: number
}

function toCompletedMinuteBoundary(nowMs: number): number {
  return Math.floor(nowMs / MINUTE_MS) * MINUTE_MS
}

function toMinuteMap(
  classifications: ClassificationEntry[],
  completedBoundaryMs: number
): Map<number, MinuteState> {
  const minuteMap = new Map<number, MinuteState>()

  for (const classification of classifications) {
    const timestampMs = Date.parse(classification.timestamp)
    if (Number.isNaN(timestampMs)) continue

    const attributedMs = timestampMs - CLASSIFICATION_ATTRIBUTION_OFFSET_MS
    const minuteKey = Math.floor(attributedMs / MINUTE_MS) * MINUTE_MS
    if (minuteKey + MINUTE_MS > completedBoundaryMs) continue

    const existing = minuteMap.get(minuteKey)
    if (!existing || timestampMs > existing.timestampMs) {
      minuteMap.set(minuteKey, { onGoal: classification.onGoal, timestampMs })
    }
  }

  return minuteMap
}

function toMinuteBlocks(
  minuteMap: Map<number, MinuteState>,
  completedBoundaryMs: number
): MinuteClassification[] {
  if (minuteMap.size === 0) return []

  const firstMinuteMs = Math.min(...minuteMap.keys())
  const blocks: MinuteClassification[] = []

  let carryForward: { onGoal: boolean; sourceMinuteMs: number } | null = null
  for (let minuteMs = firstMinuteMs; minuteMs < completedBoundaryMs; minuteMs += MINUTE_MS) {
    const direct = minuteMap.get(minuteMs)
    if (direct) {
      carryForward = { onGoal: direct.onGoal, sourceMinuteMs: minuteMs }
      blocks.push({ startMs: minuteMs, endMs: minuteMs + MINUTE_MS, onGoal: direct.onGoal })
      continue
    }

    if (!carryForward) continue
    if (minuteMs - carryForward.sourceMinuteMs > CLASSIFICATION_CARRY_FORWARD_MS) {
      carryForward = null
      continue
    }

    blocks.push({ startMs: minuteMs, endMs: minuteMs + MINUTE_MS, onGoal: carryForward.onGoal })
  }

  return blocks
}

export function buildClassificationMinuteBlocks(
  classifications: ClassificationEntry[],
  nowMs: number
): MinuteClassification[] {
  const completedBoundaryMs = toCompletedMinuteBoundary(nowMs)
  const minuteMap = toMinuteMap(classifications, completedBoundaryMs)
  const minuteBlocks = toMinuteBlocks(minuteMap, completedBoundaryMs)
  return mergeAdjacentBlocks(minuteBlocks, (left, right) => left.onGoal === right.onGoal)
}
