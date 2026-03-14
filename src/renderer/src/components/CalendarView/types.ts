export interface ActivityEvent {
  id: number
  timestamp: string
  duration: number
  data: {
    app: string
    title: string
  }
}

export interface ClassificationEntry {
  timestamp: string
  app: string
  title: string
  onGoal: boolean
  confidence: number
  reasoning: string
}
