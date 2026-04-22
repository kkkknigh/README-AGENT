const runControllers = new Map<string, AbortController>()

export function createRunAbortController(runId: string) {
  const controller = new AbortController()
  runControllers.set(runId, controller)
  return controller
}

export function getRunAbortSignal(runId: string) {
  return runControllers.get(runId)?.signal
}

export function abortRun(runId: string) {
  const controller = runControllers.get(runId)
  if (!controller) return false
  controller.abort()
  runControllers.delete(runId)
  return true
}

export function clearRunAbortController(runId: string) {
  runControllers.delete(runId)
}
