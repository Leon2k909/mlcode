import { afterEach, expect, it, vi } from "vite-plus/test";
import { fetchWithoutUpstreamT3 } from "./connectAuth.ts";

afterEach(() => vi.unstubAllGlobals());

it("blocks upstream services and leaves provider and ML Code requests available", async () => {
  const fetch = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetch);
  for (const url of [
    "https://ingest.t3.codes/batch/",
    "https://nightly.app.t3.codes/",
    "https://prod.t3coderelay.com/api/threads",
    "https://api.github.com/repos/pingdotgg/t3code/issues",
    "https://raw.githubusercontent.com/pingdotgg/t3code/main/config.json",
  ]) {
    await expect(fetchWithoutUpstreamT3(new Request(url))).rejects.toThrow("ML Code blocks");
  }
  expect(fetch).not.toHaveBeenCalled();
  await fetchWithoutUpstreamT3("https://api.anthropic.com/v1/models");
  await fetchWithoutUpstreamT3("https://api.github.com/repos/Leon2k909/mlcode/releases");
  expect(fetch).toHaveBeenCalledTimes(2);
});
