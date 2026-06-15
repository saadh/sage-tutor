/**
 * One-shot Photon/iMessage delivery probe.
 * Sends a single message to MY_PHONE and prints the FULL result or error,
 * then exits. Use to tell "send failed" from "send succeeded but not delivered".
 *   node --env-file-if-exists=.env --import tsx send-test.ts
 */
import { Spectrum } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";

const { PROJECT_ID, PROJECT_SECRET, MY_PHONE } = process.env;
console.log("PROJECT_ID set:", !!PROJECT_ID, "| SECRET set:", !!PROJECT_SECRET, "| MY_PHONE:", MY_PHONE);

if (!PROJECT_ID || !PROJECT_SECRET || !MY_PHONE) {
  console.error("Missing PROJECT_ID / PROJECT_SECRET / MY_PHONE in .env");
  process.exit(1);
}

const app = await Spectrum({
  projectId: PROJECT_ID,
  projectSecret: PROJECT_SECRET,
  providers: [imessage.config()],
});
console.log("Spectrum up. Sending probe to", MY_PHONE, "…");

try {
  const im = imessage(app);
  const user = await im.user(MY_PHONE);
  console.log("resolved user:", JSON.stringify(user));
  const space = await im.space(user);
  console.log("resolved space:", JSON.stringify(space));
  const res = await space.send(`Sage delivery probe ${new Date().toISOString().slice(11, 19)} — did this arrive?`);
  console.log("SEND RETURNED OK:", JSON.stringify(res));
} catch (e: any) {
  console.error("SEND THREW:");
  console.error("  message:", e?.message);
  console.error("  cause:  ", JSON.stringify(e?.cause));
  console.error("  full:   ", e);
}
process.exit(0);
