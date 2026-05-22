import type {
  User,
  Election,
  Candidate,
  Vote,
  PendingBallot,
  ChallengeRecord,
  BulletinBoard,
  AggregatorReport,
  AttackLog,
  BlockchainAuditRecord
} from "@verivote/shared";
import type { PersistenceAdapter } from "./persistence.js";

export const users: User[] = [];
export const elections: Election[] = [];
export const candidates: Candidate[] = [];
export const votes: Vote[] = [];
export const pendingBallots: PendingBallot[] = [];
export const challengeRecords: ChallengeRecord[] = [];
export const bulletinBoards: BulletinBoard[] = [];
export const aggregatorReports: AggregatorReport[] = [];
export const attackLogs: AttackLog[] = [];
export const blockchainAuditRecords = new Map<string, BlockchainAuditRecord>();

export const counters = {
  user: 0,
  election: 0,
  candidate: 0,
  vote: 0,
  pendingBallot: 0,
  challengeRecord: 0,
  attack: 0
};

export function createId(prefix: keyof typeof counters): string {
  counters[prefix] += 1;
  return `${prefix}_${counters[prefix]}`;
}

export function findElection(electionId: string): Election | undefined {
  return elections.find((election) => election.id === electionId);
}

export function getCandidatesForElection(electionId: string): Candidate[] {
  return candidates.filter((candidate) => candidate.electionId === electionId);
}

export function findBulletinBoard(electionId: string): BulletinBoard | undefined {
  return bulletinBoards.find((bulletin) => bulletin.electionId === electionId);
}

export function findAggregatorReport(electionId: string): AggregatorReport | undefined {
  return aggregatorReports.find((report) => report.electionId === electionId);
}

export function findFirstVote(electionId: string): Vote | undefined {
  return votes.find((vote) => vote.electionId === electionId);
}

export let saveAggregatorReport = (report: AggregatorReport): void => {
  const existingIndex = aggregatorReports.findIndex(
    (currentReport) => currentReport.electionId === report.electionId
  );

  if (existingIndex === -1) {
    aggregatorReports.push(report);
    return;
  }

  aggregatorReports[existingIndex] = report;
};

export function setSaveAggregatorReport(fn: typeof saveAggregatorReport): void {
  saveAggregatorReport = fn;
}

export let persistence: PersistenceAdapter | null = null;

export function setPersistence(adapter: PersistenceAdapter | null): void {
  persistence = adapter;
}

export function persistCounters(): void {
  persistence?.saveCounters({ ...counters });
}
