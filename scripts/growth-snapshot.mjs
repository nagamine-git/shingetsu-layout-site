import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
const repository = "nagamine-git/shingetsu-layout";

async function fetchGitHub(path) {
  const { stdout } = await execute("gh", ["api", `repos/${repository}${path}`]);
  return JSON.parse(stdout);
}

const metadata = await fetchGitHub("");
const endpoints = {
  views: "/traffic/views",
  clones: "/traffic/clones",
  referrers: "/traffic/popular/referrers",
  paths: "/traffic/popular/paths",
};
const traffic = Object.fromEntries(
  await Promise.all(
    Object.entries(endpoints).map(async ([name, path]) => {
      try {
        return [name, { status: "available", data: await fetchGitHub(path) }];
      } catch {
        return [name, { status: "unavailable", data: null }];
      }
    }),
  ),
);

process.stdout.write(`${JSON.stringify({
  capturedAt: new Date().toISOString(),
  repository,
  stars: metadata.stargazers_count,
  target: 101,
  remaining: Math.max(0, 101 - metadata.stargazers_count),
  traffic,
}, null, 2)}\n`);
