import { useEffect, useState } from "react";
import type { Election, ListElectionsResponse } from "@verivote/shared";
import {
  type View,
  type Portal,
  type ActivePortal,
  type Notice,
  NoticeMessage,
  portalNavItems,
  portalLabels,
  apiRequest,
  getErrorMessage
} from "./common";
import "./styles.css";

import { PlatformHomePage, HomePage } from "./pages/HomePage";
import { CreateElectionPage } from "./pages/CreateElectionPage";
import { RegisterUserPage } from "./pages/RegisterUserPage";
import { VotePage } from "./pages/VotePage";
import { ChallengeAuditPage } from "./pages/ChallengeAuditPage";
import { ReceiptQueryPage } from "./pages/ReceiptQueryPage";
import { ResultPage } from "./pages/ResultPage";
import { BulletinBoardPage } from "./pages/BulletinBoardPage";
import { MerkleVerificationPage } from "./pages/MerkleVerificationPage";
import { AggregatorPage } from "./pages/AggregatorPage";
import { AuditReportPage } from "./pages/AuditReportPage";
import { ChainAuditPage } from "./pages/ChainAuditPage";
import { ZkValidationPage } from "./pages/ZkValidationPage";
import { PedersenExperimentPage } from "./pages/PedersenExperimentPage";
import { TallyZkPage } from "./pages/TallyZkPage";
import { ArtifactExportPage } from "./pages/ArtifactExportPage";
import { PerformancePage } from "./pages/PerformancePage";
import { AttackLabPage } from "./pages/AttackLabPage";

// TODO: 这文件太长了，后面有空把路由拆到单独文件里去
export function App() {
  const [portal, setPortal] = useState<Portal>("home");
  const [view, setView] = useState<View>("home");
  const [elections, setElections] = useState<Election[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const activePortal = portal === "home" ? null : portal;
  const activeNavItems = activePortal ? portalNavItems[activePortal] : [];

  async function refreshElections() {
    try {
      const data = await apiRequest<ListElectionsResponse>("/elections");
      setElections(data.elections);
      setNotice(null);
    } catch (error) {
      setNotice({ type: "error", text: getErrorMessage(error) });
    }
  }

  useEffect(() => {
    void refreshElections();
  }, []);

  function enterPortal(nextPortal: ActivePortal) {
    setPortal(nextPortal);
    setView("home");
  }

  function goPlatformHome() {
    setPortal("home");
    setView("home");
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-group">
          <button type="button" className="brand" onClick={goPlatformHome}>
            VeriVote
          </button>
          {activePortal ? (
            <span className="portal-chip">{portalLabels[activePortal].title}</span>
          ) : null}
        </div>
        {activePortal ? (
          <div className="topbar-actions">
            <nav aria-label={`${portalLabels[activePortal].title}导航`}>
              {activeNavItems.map((item) => (
                <button
                  key={item.view}
                  type="button"
                  className={view === item.view ? "active" : ""}
                  onClick={() => setView(item.view)}
                >
                  {item.label}
                </button>
              ))}
            </nav>
            <button type="button" className="secondary home-return" onClick={goPlatformHome}>
              平台首页
            </button>
          </div>
        ) : null}
      </header>

      <main>
        <NoticeMessage notice={notice} />
        {activePortal ? (
          <>
            {view === "home" ? (
              <HomePage
                portal={activePortal}
                elections={elections}
                onRefresh={refreshElections}
              />
            ) : null}
            {view === "create" ? (
              <CreateElectionPage
                elections={elections}
                onRefreshElections={refreshElections}
              />
            ) : null}
            {view === "register" ? (
              <RegisterUserPage
                title={portalLabels[activePortal].registerTitle}
                description={portalLabels[activePortal].registerLead}
              />
            ) : null}
            {view === "vote" ? <VotePage elections={elections} /> : null}
            {view === "challengeAudit" ? (
              <ChallengeAuditPage elections={elections} />
            ) : null}
            {view === "receipt" ? <ReceiptQueryPage /> : null}
            {view === "result" ? <ResultPage elections={elections} /> : null}
            {view === "bulletin" ? (
              <BulletinBoardPage
                elections={elections}
                onRefreshElections={refreshElections}
              />
            ) : null}
            {view === "merkle" ? <MerkleVerificationPage /> : null}
            {view === "aggregator" ? (
              <AggregatorPage elections={elections} />
            ) : null}
            {view === "audit" ? <AuditReportPage elections={elections} /> : null}
            {view === "chainAudit" ? (
              <ChainAuditPage elections={elections} />
            ) : null}
            {view === "zk" ? <ZkValidationPage /> : null}
            {view === "pedersen" ? <PedersenExperimentPage /> : null}
            {view === "tallyZk" ? (
              <TallyZkPage elections={elections} />
            ) : null}
            {view === "export" ? (
              <ArtifactExportPage elections={elections} />
            ) : null}
            {view === "benchmark" ? <PerformancePage /> : null}
            {view === "attack" ? <AttackLabPage elections={elections} /> : null}
          </>
        ) : (
          <PlatformHomePage onSelectPortal={enterPortal} />
        )}
      </main>
    </div>
  );
}
