/** RocketRide hello-world: load sage-hello.pipe, ask one question through
 *  the Butterbase-gateway LLM node, print the answer. */
import { RocketRideClient, Question } from "rocketride";

const client = new RocketRideClient({
  uri: process.env.ROCKETRIDE_URI ?? "ws://localhost:5565",
  ...(process.env.ROCKETRIDE_APIKEY ? { auth: process.env.ROCKETRIDE_APIKEY } : {}),
  module: "SAGE-HELLO",
});

try {
  await client.connect();
  console.log("✓ connected to RocketRide engine");
  const { token } = await client.use({ filepath: "../pipelines/sage-hello.pipe" });
  console.log("✓ pipeline loaded, token:", String(token).slice(0, 12) + "…");
  const question = new Question();
  question.addQuestion("Reply with exactly: SAGE PIPELINE OK");
  const response: any = await client.chat({ token, question });
  console.log("✓ answer:", JSON.stringify(response?.data?.answer ?? response?.answers ?? response).slice(0, 300));
  await client.terminate(token);
} finally {
  await client.disconnect();
}
