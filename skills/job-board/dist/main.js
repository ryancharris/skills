#!/usr/bin/env node
/**
 * Entry point.
 *
 * Self-locating: the skill directory is resolved from this file, so it runs from
 * any working directory without installation.
 *
 * Exit by setting `process.exitCode`, not by calling `process.exit()`. Writes to a
 * pipe are asynchronous, and `process.exit()` dropped whatever was still queued
 * (output was cut at 64 KiB when piped).
 */
import { main } from "./cli.js";
// A reader that closes early (`| head`) is not an error worth a stack trace.
for (const stream of [process.stdout, process.stderr]) {
    stream.on("error", (err) => {
        if (err.code === "EPIPE")
            process.exit(0);
        throw err;
    });
}
main(process.argv.slice(2))
    .then((code) => {
    process.exitCode = code;
})
    .catch((err) => {
    process.stderr.write(`error: ${err?.stack ?? err}\n`);
    process.exitCode = 1;
});
