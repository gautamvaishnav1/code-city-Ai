export function makeFileKey (relativePath: string): string {
  return `file:${relativePath}`
}

export function makeClassKey (relativePath: string, className: string): string {
  return `class:${relativePath}:${className}`
}

export function makeFunctionKey (
  relativePath: string,
  name?: string | null,
  node?: any,
): string {
  if (name) {
    return `function:${relativePath}:${name}`
  }
  const line = node?.loc?.start?.line ?? 0
  return `function:${relativePath}:anonymous:${line}`
}

export function makeMethodKey (
  relativePath: string,
  className: string | null,
  methodName: string,
): string {
  if (className) {
    return `method:${relativePath}:${className}.${methodName}`
  }

  return `method:${relativePath}:${methodName}`
}
