# Brand assets

| File               | What / where to use                                                                                                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `onadiet-icon.png` | The mascot mark — a dark creature chomping red pixel-blocks that shrink away (it's _eating the bytes_). 512px master. Use for the README hero, favicon, npm/GitHub avatar, and social. |

## Notes

- **Kept lean on purpose.** We store one 512px master (~200 KB), not the full-res design source — a repo
  whose whole job is killing bloat shouldn't ship a 1 MB logo. The original 1254px PNG and the (raster-in-)
  SVG live in the design folder outside the repo.
- **Regenerate sizes** with macOS `sips`, e.g. a 256px favicon: `sips -Z 256 onadiet-icon.png --out favicon-256.png`.
- **Nice-to-have later:** a true-vector redraw (the current "SVG" is a wrapped raster). Or, fittingly, run
  the finished tool on our own logo. 🙂
