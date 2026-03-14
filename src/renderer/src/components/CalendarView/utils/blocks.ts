export interface TimeBlock {
  startMs: number
  endMs: number
}

export function mergeAdjacentBlocks<T extends TimeBlock>(
  blocks: T[],
  canMerge: (left: T, right: T) => boolean
): T[] {
  if (blocks.length === 0) return []

  const merged = [{ ...blocks[0] }]

  for (let index = 1; index < blocks.length; index += 1) {
    const current = blocks[index]
    const previous = merged[merged.length - 1]

    if (canMerge(previous, current) && previous.endMs === current.startMs) {
      previous.endMs = current.endMs
      continue
    }

    merged.push({ ...current })
  }

  return merged.filter((block) => block.endMs > block.startMs)
}
