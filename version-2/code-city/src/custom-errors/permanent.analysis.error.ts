export class PermanentAnalysisError extends Error {
  constructor (message: string) {
    super(message)
    this.name = 'PermanentAnalysisError'
  }
}
