# Security policy

## Supported versions

onadiet is pre-1.0 (`0.x`). Security fixes land on the **latest** released version; there are no long-term
support branches yet.

## Reporting a vulnerability

**Please report privately — do not open a public issue for a security problem.**

Use GitHub's **private vulnerability reporting**: on this repository, go to the **Security** tab →
**Report a vulnerability**. This opens a private advisory visible only to the maintainers.

In your report, please include:

- what the issue is and the impact you foresee,
- steps to reproduce (a minimal input file / command is ideal),
- affected version(s), and
- any suggested fix or mitigation.

We'll acknowledge as soon as we reasonably can (this is a small, volunteer-maintained project), work with you
on a fix, and credit you in the advisory unless you'd prefer to stay anonymous. Please give us a reasonable
window to release a fix before any public disclosure.

## Scope notes

onadiet runs **entirely locally** — it never uploads your files and makes no network calls, so there is no
server, no upload endpoint, and no remote attack surface. It does, however, **parse and re-encode untrusted
input files** (PDFs, images, SVGs) and write output to disk. The areas most in scope:

- **The output-safety guarantees.** onadiet must **never overwrite the original**, **never write a file
  larger than the input**, and write via a **temp file + atomic rename**. Any path that mutates or corrupts a
  user's original, or clobbers an unrelated file, is in scope.
- **Signed / form PDFs.** onadiet detects and **refuses (or warns) rather than silently re-saving** a signed
  or form PDF — a silent signature/AcroForm break that destroys the document's integrity is in scope.
- **Untrusted-decode resource limits.** Decoding a hostile input must not exhaust memory or hang: raster
  decodes are pixel-capped (≈100 MP) and inputs can be size-capped (`--max-input`). A **decompression / pixel
  bomb** (a tiny file that expands to an enormous raster or DOM), an XML-entity-expansion ("billion laughs")
  or external-entity fetch via an SVG, or any bypass of the pixel/size cap that OOMs or wedges the process,
  is in scope.
- **Folder-mode path safety.** In folder mode onadiet walks a tree and mirrors outputs. A path-traversal or
  symlink that causes a write **outside the intended output directory**, or a TOCTOU that redirects a write,
  is in scope. (Zip/archive in-out is deliberately not built yet — its Zip-Slip / bomb hardening is tracked
  in the roadmap.)
- **Copyleft-engine boundary.** onadiet ships **permissive-only** and never bundles Ghostscript (AGPL) or
  pngquant (GPL); they are optional, PATH-detected, opt-in adapters. A path that invokes or bundles a
  copyleft engine without the user opting in is a licensing/security concern worth reporting.

Out of scope: issues that require deliberately hostile local configuration or a malicious PATH the user
controls, and vulnerabilities in the **upstream engines** onadiet drives (e.g. a libvips/sharp or qpdf CVE) —
those are upstream, not an onadiet vulnerability. Reports for those are still welcome, but they're upstream.
