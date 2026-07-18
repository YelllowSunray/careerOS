/**
 * Cloud Run worker entry point for the Browser Application Agent.
 * Deploy separately from the Next.js app for long-running Playwright sessions.
 *
 * Usage: npx tsx workers/browser-agent/index.ts
 */
import { createServer } from "http";
import { runBrowserAgent } from "@/agents/browser/browser-agent";
import { getProfile, getApplication } from "@/services/firestore";

const PORT = Number(process.env.PORT ?? 8080);
const AUTH_SECRET = process.env.WORKER_AUTH_SECRET;

const server = createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/apply") {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  if (AUTH_SECRET && req.headers["x-worker-secret"] !== AUTH_SECRET) {
    res.writeHead(401);
    res.end("Unauthorized");
    return;
  }

  let body = "";
  for await (const chunk of req) body += chunk;

  try {
    const { applicationId, userId } = JSON.parse(body);
    const [profile, application] = await Promise.all([
      getProfile(userId),
      getApplication(applicationId),
    ]);

    if (!profile || !application) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    const session = await runBrowserAgent({
      applicationId,
      applicationUrl: application.applicationUrl,
      profile,
      userId,
      jobTitle: application.jobTitle,
      company: application.company,
      jobDescription: application.jobDescription,
    });

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(session));
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: e instanceof Error ? e.message : "Worker failed",
      })
    );
  }
});

server.listen(PORT, () => {
  console.log(`Browser agent worker listening on :${PORT}`);
});
