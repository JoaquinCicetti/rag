/** Usage: bun run traces [id-prefix] [--limit 20] [--prompt] [--json] */
import { parseArgs } from "node:util";
import { formatTrace, formatTraceList } from "../observability/format.ts";
import { findTrace, readTraces } from "../observability/trace.ts";

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    limit: { type: "string", short: "n" },
    prompt: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
  },
});

const id = positionals[0];
if (!id) {
  const traces = await readTraces({ limit: values.limit ? Number(values.limit) : 20 });
  console.log(values.json ? JSON.stringify(traces, null, 2) : formatTraceList(traces));
  process.exit(0);
}

const trace = await findTrace(id);
if (!trace) {
  console.error(`no trace matching "${id}"`);
  process.exit(1);
}
console.log(values.json ? JSON.stringify(trace, null, 2) : formatTrace(trace, { prompt: values.prompt }));
