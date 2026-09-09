declare module "legacy-word-reader" {
  interface WordReader {
    (input: ArrayBuffer | Uint8Array): string | null
    html: (input: ArrayBuffer | Uint8Array) => Record<string, string> | null
    sections: (input: ArrayBuffer | Uint8Array) => (Record<string, unknown> & { body: string, html: Record<string, string>, model: Record<string, import("@shared/attachment-doc-model").WordParagraph[]> }) | null
  }
  const reader: WordReader
  export default reader
}
