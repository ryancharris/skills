#!/usr/bin/env node
/**
 * Entry point.
 *
 * Self-locating: the skill directory is resolved from this file, so it runs from
 * any working directory without installation.
 */
import { main } from "./cli.js";
main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
    process.stderr.write(`error: ${err?.stack ?? err}\n`);
    process.exit(1);
});
