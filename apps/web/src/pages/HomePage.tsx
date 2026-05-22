import type { Election } from "@verivote/shared";
import { portalCards, capabilityLayers, portalLabels, type ActivePortal } from "../common";

interface PlatformHomePageProps {
  onSelectPortal: (portal: ActivePortal) => void;
}

export function PlatformHomePage({ onSelectPortal }: PlatformHomePageProps) {
  return (
    <section className="page-section platform-home">
      <div className="platform-hero">
        <p className="eyebrow">VeriVote</p>
        <h1>VeriVote</h1>
        <p>隐私保护可验证电子投票系统</p>
      </div>

      <div className="portal-card-grid">
        {portalCards.map((card) => (
          <button
            key={card.portal}
            type="button"
            className={`portal-card ${card.portal}`}
            onClick={() => onSelectPortal(card.portal)}
          >
            <span>{card.subtitle}</span>
            <strong>{card.title}</strong>
            <p>{card.description}</p>
            <ul>
              {card.highlights.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </button>
        ))}
      </div>

      <div className="capability-grid">
        {capabilityLayers.map((layer) => (
          <section key={layer.title} className="capability-panel">
            <h2>{layer.title}</h2>
            <div className="capability-list">
              {layer.items.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}

interface HomePageProps {
  portal: ActivePortal;
  elections: Election[];
  onRefresh: () => Promise<void>;
}

export function HomePage({ portal, elections, onRefresh }: HomePageProps) {
  const portalInfo = portalLabels[portal];

  return (
    <section className="page-section">
      <div className="section-header">
        <div>
          <p className="eyebrow">{portalInfo.subtitle}</p>
          <h1>{portalInfo.homeTitle}</h1>
        </div>
        <button type="button" className="secondary" onClick={() => void onRefresh()}>
          刷新
        </button>
      </div>

      <p className="page-lead">{portalInfo.homeLead}</p>

      <div className="stats">
        <div>
          <span>{elections.length}</span>
          <p>投票数</p>
        </div>
        <div>
          <span>{elections.filter((election) => election.status === "active").length}</span>
          <p>进行中</p>
        </div>
      </div>

      <div className="panel">
        <h2>投票列表</h2>
        {elections.length === 0 ? (
          <p className="empty">暂无投票</p>
        ) : (
          <div className="list">
            {elections.map((election) => (
              <article key={election.id} className="list-row">
                <div>
                  <strong>{election.title}</strong>
                  <p>{election.description || "无描述"}</p>
                </div>
                <code>{election.id}</code>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
