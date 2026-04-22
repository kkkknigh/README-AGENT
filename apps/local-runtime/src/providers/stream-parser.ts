export function parseJsonObject<T>(input: string) {
  try {
    return JSON.parse(input) as T
  } catch {
    const fenced = input.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim()
    if (fenced) {
      return JSON.parse(fenced) as T
    }

    const start = input.indexOf("{")
    const end = input.lastIndexOf("}")
    if (start >= 0 && end > start) {
      return JSON.parse(input.slice(start, end + 1)) as T
    }
    throw new Error("Failed to parse JSON object from model response")
  }
}
