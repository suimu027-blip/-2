import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const API_BASE_URL = process.env.VERIVOTE_API_BASE_URL ?? "http://localhost:3001";

interface ApiEnvelope<T> {
  [key: string]: unknown;
}

async function requestJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {})
    }
  });
  const data = (await response.json().catch(() => null)) as
    | { error?: string }
    | T
    | null;

  if (!response.ok) {
    throw new Error(
      data && typeof data === "object" && "error" in data && data.error
        ? data.error
        : `Request failed: ${response.status} ${path}`
    );
  }

  return data as T;
}

async function main(): Promise<void> {
  const electionResponse = await requestJson<{
    election: { id: string; title: string };
  }>("/elections", {
    method: "POST",
    body: JSON.stringify({
      title: "VeriVote Demo Election v2",
      description: "4 candidates, 8 users, 8 cast votes, 2 challenge ballots"
    })
  });
  const electionId = electionResponse.election.id;

  const candidateNames = ["Ada", "Bert", "Cora", "Drew"];
  const candidates = [];
  for (const name of candidateNames) {
    const data = await requestJson<{
      candidate: { id: string; name: string };
    }>(`/elections/${encodeURIComponent(electionId)}/candidates`, {
      method: "POST",
      body: JSON.stringify({ name })
    });
    candidates.push(data.candidate);
  }

  const users = [];
  for (let index = 0; index < 8; index += 1) {
    const data = await requestJson<{
      user: { id: string; name: string };
      userId: string;
    }>("/users/register", {
      method: "POST",
      body: JSON.stringify({ name: `Demo User ${index + 1}` })
    });
    users.push(data.user);
  }

  const receipts = [];
  for (let index = 0; index < users.length; index += 1) {
    const user = users[index];
    const candidate = candidates[index % candidates.length];
    const vote = await requestJson<{
      voteId: string;
      receiptCode: string;
      commitment: string;
    }>(`/elections/${encodeURIComponent(electionId)}/vote`, {
      method: "POST",
      body: JSON.stringify({
        userId: user.id,
        candidateId: candidate.id
      })
    });
    receipts.push({ userId: user.id, candidateId: candidate.id, ...vote });
  }

  const challengeRecords = [];
  for (let index = 0; index < 2; index += 1) {
    const pending = await requestJson<{
      pendingBallot: { id: string };
    }>(`/challenge/elections/${encodeURIComponent(electionId)}/prepare`, {
      method: "POST",
      body: JSON.stringify({
        userId: users[index].id,
        candidateId: candidates[(index + 1) % candidates.length].id
      })
    });
    const challenge = await requestJson<ApiEnvelope<unknown>>(
      `/challenge/ballots/${encodeURIComponent(pending.pendingBallot.id)}/challenge`,
      { method: "POST" }
    );
    challengeRecords.push(challenge);
  }

  await requestJson(`/elections/${encodeURIComponent(electionId)}/finalize`, {
    method: "POST"
  });
  const aggregator = await requestJson<ApiEnvelope<unknown>>(
    `/aggregator/elections/${encodeURIComponent(electionId)}/run`,
    { method: "POST" }
  );

  const exportBundle = await requestJson<{ bundle: unknown }>(
    `/elections/${encodeURIComponent(electionId)}/export-bundle`
  );

  const outputDir = join("docs", "assets", "demo-materials", "export-bundle");
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(
    join(outputDir, `verivote_bundle_${electionId}.json`),
    `${JSON.stringify(exportBundle.bundle, null, 2)}\n`,
    "utf8"
  );

  console.log(
    JSON.stringify(
      {
        apiBaseUrl: API_BASE_URL,
        electionId,
        candidates,
        users,
        receipts,
        challengeRecords: challengeRecords.length,
        aggregatorGenerated: Boolean(aggregator),
        exportBundlePath: join(outputDir, `verivote_bundle_${electionId}.json`)
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
