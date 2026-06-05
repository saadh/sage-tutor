/**
 * Sage echo bot — Photon/Spectrum milestone #1.
 *
 * Run locally (no credentials needed):   npm run dev
 * With PROJECT_ID + PROJECT_SECRET in .env (from https://app.photon.codes →
 * project Settings), the iMessage provider activates. Photon's free tier has
 * no inbound number — the agent texts FIRST. Set MY_PHONE in .env and the bot
 * opens the iMessage thread to you on startup; reply there to chat.
 */
import { Spectrum } from "spectrum-ts";
import { terminal } from "spectrum-ts/providers/terminal";
import { imessage } from "spectrum-ts/providers/imessage";

let { PROJECT_ID, PROJECT_SECRET, MY_PHONE } = process.env;
if (PROJECT_ID?.startsWith("paste-your")) PROJECT_ID = PROJECT_SECRET = undefined;

async function makeApp() {
  if (PROJECT_ID && PROJECT_SECRET) {
    const app = await Spectrum({
      projectId: PROJECT_ID,
      projectSecret: PROJECT_SECRET,
      providers: [terminal.config(), imessage.config()],
    });
    console.log("Sage echo bot up — terminal + iMessage providers active.");

    if (MY_PHONE) {
      try {
        const im = imessage(app);
        const me = await im.user(MY_PHONE);
        const space = await im.space(me);
        await space.send("Sage here — your tutor is online 🎓 Reply anything and I'll echo it back.");
        console.log(`Outbound hello sent to ${MY_PHONE} — check your phone.`);
      } catch (err) {
        console.error("Outbound iMessage failed:", err);
      }
    } else {
      console.log("Tip: set MY_PHONE in .env and restart — Sage will text you to open the thread.");
    }
    return app;
  }

  console.log("Sage echo bot up — terminal only (add PROJECT_ID/PROJECT_SECRET to .env for iMessage).");
  return Spectrum({ providers: [terminal.config()] });
}

const app = await makeApp();

for await (const [space, message] of app.messages) {
  if (message.content.type !== "text") continue;
  const text = message.content.text;
  console.log(`[${message.platform}] ${message.sender?.id ?? "unknown"}: ${text}`);

  // The echo — wrapped in responding() so real platforms show a typing indicator.
  await space.responding(async () => {
    await message.reply(`echo: ${text}`);
  });
}
