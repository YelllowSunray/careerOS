export function sanitizeForFirestore<T>(data: T): T {
  if (data === null || data === undefined) {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeForFirestore(item)) as T;
  }

  if (typeof data === "object" && !(data instanceof Date)) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue;
      result[key] = sanitizeForFirestore(value);
    }
    return result as T;
  }

  return data;
}
