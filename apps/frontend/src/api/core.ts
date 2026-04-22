import axios from "axios"

export const API_BASE =
  __READMECLAW_LOCAL_RUNTIME_URL__ ??
  "http://127.0.0.1:4242"

export const api = axios.create({
  baseURL: API_BASE,
  timeout: 60000,
})

let memoryAccessToken: string | null = "desktop-local-token"
const uploadedPdfBlobs = new Map<string, Blob>()

export function getAccessToken() {
  return memoryAccessToken
}

export function getRefreshToken() {
  return null
}

export function setTokens(accessToken: string) {
  memoryAccessToken = accessToken
}

export function clearTokens() {
  memoryAccessToken = null
}

export function isAuthenticated() {
  return true
}

export async function openStreamResponse(path: string, payload: unknown, _retryOnUnauthorized = true, signal?: AbortSignal) {
  return fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  })
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export function setBlobForDocument(pdfId: string, blob: Blob) {
  uploadedPdfBlobs.set(pdfId, blob)
}

export function deleteBlobForDocument(pdfId: string) {
  uploadedPdfBlobs.delete(pdfId)
}

function buildDemoPdfBlob(title: string) {
  const safeTitle = title.replace(/[()]/g, "")
  const pdf = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length 93 >>
stream
BT
/F1 24 Tf
72 720 Td
(${safeTitle}) Tj
0 -36 Td
/F1 12 Tf
(READMEClaw Desktop Local Preview) Tj
ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f 
0000000010 00000 n 
0000000063 00000 n 
0000000122 00000 n 
0000000248 00000 n 
0000000391 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
461
%%EOF`
  return new Blob([pdf], { type: "application/pdf" })
}

export function getPdfBlob(pdfId: string) {
  return uploadedPdfBlobs.get(pdfId) ?? buildDemoPdfBlob(pdfId)
}

export function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ""
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}
