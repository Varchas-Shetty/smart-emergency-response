export function json(data: unknown, init?: ResponseInit) {
  return Response.json({ data }, init);
}

export function apiError(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status });
}

export function handleApiError(error: unknown) {
  if (error && typeof error === "object" && "issues" in error) {
    return apiError("VALIDATION_ERROR", "The request did not pass validation.", 400);
  }
  console.error("API request failed", error);
  return apiError("INTERNAL_ERROR", "The request could not be completed.", 500);
}
