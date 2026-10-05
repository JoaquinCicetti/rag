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

const traceId = positionals[0];
if (!traceId) {
  const traces = await readTraces({ limit: values.limit ? Number(values.limit) : 20 });
  console.log(values.json ? JSON.stringify(traces, null, 2) : formatTraceList(traces));
  process.exit(0);
}

const trace = await findTrace(traceId);
if (!trace) {
  console.error(`no trace matching "${traceId}"`);
  process.exit(1);
}
console.log(values.json ? JSON.stringify(trace, null, 2) : formatTrace(trace, { prompt: values.prompt }));
