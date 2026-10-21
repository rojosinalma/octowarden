// Entry point of the CLI (bin/octowarden and the bundled release file).
import { main } from './index.ts'

process.exit(await main(process.argv.slice(2)))
