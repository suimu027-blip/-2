import {
  benchmarkData,
  benchmarkMetrics,
  getBenchmarkAverage,
  formatBenchmarkMs
} from "../common";

function TotalTrendChart({
  values
}: {
  values: Array<{ voteCount: number; totalMs: number }>;
}) {
  const width = 640;
  const height = 260;
  const padding = 44;
  const plotWidth = width - padding * 2;
  const plotHeight = height - padding * 2;
  const maxTotal = Math.max(...values.map((value) => value.totalMs), 1);
  const points = values.map((value, index) => {
    const x =
      values.length === 1
        ? width / 2
        : padding + (plotWidth * index) / (values.length - 1);
    const y = height - padding - (value.totalMs / maxTotal) * plotHeight;

    return {
      ...value,
      x,
      y
    };
  });
  const linePoints = points.map((point) => `${point.x},${point.y}`).join(" ");

  return (
    <svg
      className="benchmark-line-chart"
      role="img"
      aria-label="不同 voteCount 下 totalMs 趋势图"
      viewBox={`0 0 ${width} ${height}`}
    >
      <line
        className="chart-axis"
        x1={padding}
        y1={height - padding}
        x2={width - padding}
        y2={height - padding}
      />
      <line
        className="chart-axis"
        x1={padding}
        y1={padding}
        x2={padding}
        y2={height - padding}
      />
      <polyline className="chart-line" points={linePoints} />
      {points.map((point) => (
        <g key={point.voteCount}>
          <circle className="chart-point" cx={point.x} cy={point.y} r="5" />
          <text className="chart-value" x={point.x} y={point.y - 12}>
            {point.totalMs.toFixed(1)}ms
          </text>
          <text className="chart-label" x={point.x} y={height - 18}>
            {point.voteCount}
          </text>
        </g>
      ))}
    </svg>
  );
}

function ModuleAverageChart({
  values
}: {
  values: Array<{ label: string; averageMs: number }>;
}) {
  const maxAverage = Math.max(...values.map((value) => value.averageMs), 1);

  return (
    <div className="benchmark-bars" aria-label="各模块平均耗时对比图">
      {values.map((value) => (
        <div className="benchmark-bar-row" key={value.label}>
          <span>{value.label}</span>
          <div className="benchmark-bar-track">
            <div
              className="benchmark-bar-fill"
              style={{ width: `${(value.averageMs / maxAverage) * 100}%` }}
            />
          </div>
          <strong>{formatBenchmarkMs(value.averageMs)}</strong>
        </div>
      ))}
    </div>
  );
}

export function PerformancePage() {
  const benchmarkRows = benchmarkData.results;
  const totalTrendValues = benchmarkRows.map((result) => ({
    voteCount: result.voteCount,
    totalMs: getBenchmarkAverage(result.summary, "totalMs")
  }));
  const moduleAverageValues = benchmarkMetrics
    .filter((metric) => metric.key !== "totalMs")
    .map((metric) => {
      const total = benchmarkRows.reduce(
        (sum, result) => sum + getBenchmarkAverage(result.summary, metric.key),
        0
      );

      return {
        label: metric.shortLabel,
        averageMs: total / benchmarkRows.length
      };
    });

  return (
    <section className="page-section performance-page">
      <div className="section-header">
        <div>
          <p className="eyebrow">Benchmark</p>
          <h1>性能评估</h1>
        </div>
      </div>

      <p className="page-lead">
        该性能测试基于本地模拟数据，主要用于评估 commitment、Merkle
        构建、Merkle proof、聚合审计等核心流程的计算开销；链上 gas 与 ZK
        proof 性能将在后续阶段单独测试。
      </p>

      <div className="panel benchmark-env">
        <h2>测试环境</h2>
        <div className="benchmark-env-grid">
          <div>
            <span>generatedAt</span>
            <code>{benchmarkData.generatedAt}</code>
          </div>
          <div>
            <span>nodeVersion</span>
            <code>{benchmarkData.environment.nodeVersion}</code>
          </div>
          <div>
            <span>platform</span>
            <code>{benchmarkData.environment.platform}</code>
          </div>
          <div>
            <span>arch</span>
            <code>{benchmarkData.environment.arch}</code>
          </div>
        </div>
      </div>

      <div className="panel benchmark-table-panel">
        <h2>结果表格</h2>
        <table>
          <thead>
            <tr>
              <th>voteCount</th>
              {benchmarkMetrics.map((metric) => (
                <th key={metric.key}>{metric.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {benchmarkRows.map((result) => (
              <tr key={result.voteCount}>
                <td>{result.voteCount}</td>
                {benchmarkMetrics.map((metric) => (
                  <td key={metric.key}>
                    {formatBenchmarkMs(
                      getBenchmarkAverage(result.summary, metric.key)
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="two-column benchmark-chart-grid">
        <div className="panel benchmark-chart-panel">
          <h2>totalMs 趋势</h2>
          <TotalTrendChart values={totalTrendValues} />
        </div>
        <div className="panel benchmark-chart-panel">
          <h2>模块平均耗时</h2>
          <ModuleAverageChart values={moduleAverageValues} />
        </div>
      </div>

      <div className="panel benchmark-interpretation">
        <h2>结果解读</h2>
        <ul>
          <li>
            voteCount 增加时，totalMs 整体呈上升趋势，说明当前本地核心流程耗时会随投票规模扩大而增长。
          </li>
          <li>
            Merkle 构建和 commitment 生成是主要计算开销之一；在当前抽样 proof 设置下，Merkle proof 生成也占据了较明显的耗时。
          </li>
          <li>
            当前 benchmark 不包含真实链上 gas 和 ZK proof 开销，因此不能代表完整链上审计或零知识证明成本。
          </li>
          <li>后续会补充链上 gas 测试和 ZK proof 性能测试。</li>
        </ul>
      </div>
    </section>
  );
}
