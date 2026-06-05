import { MemoryClient } from "@xtraceai/memory";
const mem = new MemoryClient({ apiKey: process.env.XTRACE_API_KEY!, orgId: process.env.XTRACE_ORG_ID! });
const xtraceId = `student-${process.env.MY_PHONE!.replace(/[^0-9a-zA-Z]/g, "")}`;
console.log("xtrace user:", xtraceId);
for await (const m of mem.memories.list({ user_id: xtraceId })) {
  console.log(`[${m.type}/${(m as any).details?.status ?? "?"}] ${m.text.slice(0, 130)}`);
}
