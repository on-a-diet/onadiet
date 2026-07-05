/**
 * `@onadiet/pdf` — the PDF format adapter.
 *
 * Implements the `@onadiet/core` seams for PDFs: `detect` · `weigh` (v0.1 step 2), with `slim` to follow in
 * step 3 on the capability proven by the image-replace probe. Parse/rebuild via pdf-lib; pixels via
 * sharp/mozjpeg (JPEG/DCTDecode out — the one lossy filter valid inside a PDF). SSIM `QualityMetric` for the
 * floor. Permissive-only. Depends on core; core never depends on this.
 */
export const PDF_ADAPTER_KIND = 'pdf' as const

export { pdfAdapter } from './adapter'
export { sharpImageCodec } from './image-codec'
export { ssimMetric } from '@onadiet/core'

// Note: the low-level pdf-lib image helpers (`findImages`, `imageByteTotal`) are intentionally NOT exported
// — they leak pdf-lib types (PDFRef/PDFRawStream) onto consumers. Import them from './pdf-images' internally.
