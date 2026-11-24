export class TemporaryAnalysisError extends Error {
  constructor (message: string) {
    super(message)
    this.name = 'TemporaryAnalysisError'
  }
}
