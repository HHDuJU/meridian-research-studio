/**
 * A3.1 / A3.3: scenario endpoints exist only when
 * VITE_SCENARIO_MODE=true and MERIDIAN_MODEL_MODE=replay.
 *   POST /__scenario/reset?key=<id>
 *   POST /__scenario/retrieve  { key, query }
 */
export function scenarioModePlugin() {
  return {
    name: "meridian:scenario-reset",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const rawUrl = req.url ?? "";
        const pathOnly = rawUrl.split("?", 1)[0] ?? "";
        if (pathOnly !== "/__scenario/reset" && pathOnly !== "/__scenario/retrieve") {
          next();
          return;
        }
        const allowed =
          process.env.VITE_SCENARIO_MODE === "true" && process.env.MERIDIAN_MODEL_MODE === "replay";
        if (!allowed) {
          res.statusCode = 404;
          res.setHeader("content-type", "text/plain; charset=utf-8");
          res.end("not found");
          return;
        }
        if ((req.method ?? "GET").toUpperCase() !== "POST") {
          res.statusCode = 405;
          res.setHeader("content-type", "text/plain; charset=utf-8");
          res.end("method not allowed");
          return;
        }
        try {
          const host = String(req.headers.host ?? "127.0.0.1");
          const u = new URL(rawUrl, `http://${host}`);
          if (pathOnly === "/__scenario/reset") {
            const key = u.searchParams.get("key") ?? "";
            const mod = await server.ssrLoadModule("/src/lib/model-runtime.ts");
            mod.resetReplayCounters(key || undefined);
            res.statusCode = 204;
            res.end();
            return;
          }
          const chunks = [];
          for await (const c of req) chunks.push(c);
          const data = Buffer.concat(chunks).length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
          const key = String(data.key || u.searchParams.get("key") || "");
          const query = String(data.query || u.searchParams.get("query") || "");
          const runtime = await server.ssrLoadModule("/src/lib/model-runtime.ts");
          const retrieve = await server.ssrLoadModule("/src/lib/evidence/retrieve.ts");
          const fixture = await server.ssrLoadModule("/src/lib/evidence/fixture-adapter.ts");
          const transportMod = await server.ssrLoadModule("/src/lib/evidence/transport.ts");
          const n = runtime.nextReplayCall(key, "retrieval/fixture");
          const text = runtime.readReplayText(runtime.replayDirFromEnv(), key, "retrieval/fixture", n);
          const rec = JSON.parse(text);
          const adapter = fixture.fixtureAdapter();
          const requestUrl = fixture.fixtureRecordingUrl(query);
          const body = typeof rec.body === "string" ? rec.body : JSON.stringify(rec.body ?? rec);
          const t = transportMod.recordedTransport({
            [requestUrl]: { status: rec.status ?? 200, body },
          });
          const result = await retrieve.runSearch(adapter, query, t);
          res.statusCode = 200;
          res.setHeader("content-type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ event: result.event, items: result.items, documents: result.documents }));
        } catch (err) {
          res.statusCode = 500;
          res.setHeader("content-type", "text/plain; charset=utf-8");
          res.end(err instanceof Error ? err.message : "scenario endpoint failed");
        }
      });
    },
  };
}
