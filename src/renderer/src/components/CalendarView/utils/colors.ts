export function appToColor(app: string): string {
  let hash = 0
  for (let i = 0; i < app.length; i++) {
    hash = app.charCodeAt(i) + ((hash << 5) - hash)
  }
  return `hsl(${Math.abs(hash) % 360}, 65%, 50%)`
}

export function classificationToColor(onGoal: boolean): string {
  return onGoal ? '#22c55e' : '#ef4444'
}
