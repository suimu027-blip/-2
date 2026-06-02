import express from "express";
import { createPersistenceAdapter, type PersistenceAdapter } from "./persistence.js";
import type { BlockchainAuditRecord, Vote, AggregatorReport } from "@verivote/shared";
import {
  users,
  elections,
  candidates,
  votes,
  pendingBallots,
  challengeRecords,
  bulletinBoards,
  aggregatorReports,
  attackLogs,
  blockchainAuditRecords,
  counters,
  persistCounters,
  saveAggregatorReport,
  setSaveAggregatorReport,
  setPersistence,
  persistence
} from "./state.js";

import zkRouter from "./routes/zk.js";
import pedersenRouter from "./routes/pedersen.js";
import attackRouter from "./routes/attacks.js";
import challengeRouter from "./routes/challenges.js";
import blockchainRouter from "./routes/blockchain.js";
import electionsRouter from "./routes/elections.js";

const app = express();
const port = Number(process.env.PORT ?? 3001);

app.use(express.json());

app.use((request, response, next) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (request.method === "OPTIONS") {
    response.sendStatus(204);
    return;
  }

  next();
});

app.get("/health", (_request, response) => {
  response.json({
    ok: true,
    service: "verivote-api"
  });
});

// 挂载各种路由
app.use("/zk", zkRouter);
app.use("/crypto/pedersen", pedersenRouter);
app.use("/attack", attackRouter);
app.use("/challenge", challengeRouter);
app.use("/blockchain", blockchainRouter);
app.use("/", electionsRouter);

function initDB(adapter: PersistenceAdapter): void {
  setPersistence(adapter);

  const hydrated = {
    users,
    elections,
    candidates,
    votes,
    pendingBallots,
    challengeRecords,
    bulletinBoards,
    aggregatorReports,
    attackLogs,
    blockchainAuditRecords,
    counters
  };
  adapter.load(hydrated);

  // 劫持数组的push方法，这样存内存的时候就顺便持久化了
  function wrapPush<T>(
    arr: T[],
    save: (item: T) => void,
    onAllAfterPush?: () => void
  ): void {
    const originalPush = arr.push.bind(arr);
    arr.push = ((...items: T[]) => {
      const result = originalPush(...items);
      for (const item of items) save(item);
      onAllAfterPush?.();
      return result;
    }) as typeof arr.push;
  }

  wrapPush(users, (item) => adapter.saveUser(item), persistCounters);
  wrapPush(elections, (item) => adapter.saveElection(item), persistCounters);
  wrapPush(candidates, (item) => adapter.saveCandidate(item), persistCounters);
  wrapPush(votes, (item) => adapter.saveVote(item), persistCounters);
  wrapPush(pendingBallots, (item) => adapter.savePendingBallot(item), persistCounters);
  wrapPush(challengeRecords, (item) => adapter.saveChallengeRecord(item), persistCounters);
  wrapPush(bulletinBoards, (item) => adapter.saveBulletinBoard(item));
  wrapPush(aggregatorReports, (item) => adapter.saveAggregatorReport(item));
  wrapPush(attackLogs, (item) => adapter.saveAttackLog(item), persistCounters);

  // 处理链上审计记录的保存
  const originalSet = blockchainAuditRecords.set.bind(blockchainAuditRecords);
  blockchainAuditRecords.set = ((key: string, value: BlockchainAuditRecord) => {
    adapter.saveBlockchainAuditRecord(value);
    return originalSet(key, value);
  }) as typeof blockchainAuditRecords.set;

  // 包装splice方法处理删除逻辑（攻击实验室会用到）
  const originalSplice = votes.splice.bind(votes);
  votes.splice = ((start: number, deleteCount?: number, ...inserted: Vote[]) => {
    const deleted = originalSplice(
      start,
      deleteCount as number,
      ...(inserted as Vote[])
    );
    for (const vote of deleted) adapter.deleteVote(vote.id);
    for (const vote of inserted) adapter.saveVote(vote);
    return deleted;
  }) as typeof votes.splice;

  // 处理聚合报告的保存
  const originalSaveAggregator = saveAggregatorReport;
  setSaveAggregatorReport((report: AggregatorReport) => {
    originalSaveAggregator(report);
    adapter.saveAggregatorReport(report);
  });
}

async function startApp(): Promise<void> {
  try {
    const adapter = await createPersistenceAdapter();
    initDB(adapter);
  } catch (error) {
    console.error("[persistence] failed to initialize:", error);
    if ((process.env.VERIVOTE_PERSISTENCE ?? "auto").toLowerCase() === "sqlite") {
      process.exit(1);
    }
  }

  app.listen(port, () => {
    console.log(
      `后端跑起来了，监听端口 ${port}，当前数据库模式是: ${persistence?.mode ?? "memory"}`
    );
  });
}

startApp().catch((error) => {
  console.error(error);
  process.exit(1);
});
