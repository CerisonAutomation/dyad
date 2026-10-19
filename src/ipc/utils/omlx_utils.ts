export function getOmlxBaseUrl(): string {
  return process.env.OMLX_BASE_URL_FOR_TESTING || "http://localhost:8000";
}
