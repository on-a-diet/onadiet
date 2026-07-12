# Examples

Runnable examples of embedding the onadiet engine in your own code. Each is self-contained — see its own
README to run it.

| Example                             | What it shows                                                                                                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [worker-offload/](./worker-offload) | Running a slim **off the event loop** in a worker thread, with a small self-healing pool — the pattern for a server slimming uploads on a hot path without blocking request handling. |

For the full surface these build on, see the [API reference](../docs/guide/api-reference.md). More examples
will land as the library grows.
