"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import { apiJson, isLoggedIn } from "@/lib/api";

export default function LeaderboardPage() {
  const router = useRouter();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [animateIn, setAnimateIn] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const lb = await apiJson("/api/knowledge/leaderboard");
      setData(Array.isArray(lb) ? lb : []);
    } catch (err) {
      console.error("Leaderboard fetch failed:", err);
    } finally {
      setLoading(false);
      setTimeout(() => setAnimateIn(true), 100);
    }
  }, []);

  useEffect(() => {
    if (!isLoggedIn()) { router.replace("/login"); return; }
    loadData();
  }, [router, loadData]);

  const totalPoints = data.reduce((sum, r) => sum + r.dataset_points, 0);
  const topUser = data[0] || null;
  const top3 = data.slice(0, 3);
  const rest = data.slice(3);

  // Podium ordering: 2nd, 1st, 3rd
  const podiumOrder = top3.length >= 3
    ? [top3[1], top3[0], top3[2]]
    : top3.length === 2
      ? [top3[1], top3[0]]
      : top3;

  const medals = ["🥇", "🥈", "🥉"];
  const podiumHeights = { 0: "180px", 1: "220px", 2: "150px" };
  const podiumGradients = [
    "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)",
    "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)",
  ];

  function getBarPercent(points) {
    if (!topUser || topUser.dataset_points === 0) return 0;
    return Math.max(5, (points / topUser.dataset_points) * 100);
  }

  function timeSince(dateStr) {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now - d;
    const days = Math.floor(diffMs / 86400000);
    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    return `${months}mo ago`;
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main-content">
        {/* Header */}
        <div className="lb-header">
          <div>
            <h1 className="page-title" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span className="lb-trophy-icon">🏆</span> Leaderboard
            </h1>
            <p className="page-subtitle">
              Ranked by dataset points — every saved entry earns you a spot on the board
            </p>
          </div>
          <button className="btn btn-secondary" onClick={() => { setLoading(true); setAnimateIn(false); loadData(); }}>
            ↻ Refresh
          </button>
        </div>

        {/* Stats Strip */}
        <div className={`lb-stats-strip ${animateIn ? "lb-animate-in" : ""}`}>
          <div className="lb-stat-pill">
            <span className="lb-stat-pill-icon">👥</span>
            <div>
              <div className="lb-stat-pill-value">{data.length}</div>
              <div className="lb-stat-pill-label">Contributors</div>
            </div>
          </div>
          <div className="lb-stat-pill">
            <span className="lb-stat-pill-icon">📊</span>
            <div>
              <div className="lb-stat-pill-value">{totalPoints.toLocaleString()}</div>
              <div className="lb-stat-pill-label">Total Points</div>
            </div>
          </div>
          <div className="lb-stat-pill">
            <span className="lb-stat-pill-icon">⭐</span>
            <div>
              <div className="lb-stat-pill-value">{topUser?.user || "—"}</div>
              <div className="lb-stat-pill-label">Top Contributor</div>
            </div>
          </div>
          <div className="lb-stat-pill">
            <span className="lb-stat-pill-icon">🔥</span>
            <div>
              <div className="lb-stat-pill-value">{topUser ? timeSince(topUser.last_activity) : "—"}</div>
              <div className="lb-stat-pill-label">Latest Activity</div>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="empty-state"><span className="spinner" /></div>
        ) : data.length === 0 ? (
          <div className="lb-empty">
            <div className="lb-empty-icon">🏅</div>
            <h3>No dataset points yet</h3>
            <p>Start creating dataset entries to climb the leaderboard!</p>
            <button className="btn btn-primary" onClick={() => router.push("/create")}>
              ✏️ Create First Entry
            </button>
          </div>
        ) : (
          <>
            {/* Podium */}
            {top3.length >= 2 && (
              <div className={`lb-podium ${animateIn ? "lb-animate-in" : ""}`}>
                {podiumOrder.map((entry, idx) => {
                  const actualRank = entry.rank;
                  const podiumIdx = top3.length >= 3 ? [1, 0, 2][idx] : [1, 0][idx];
                  return (
                    <div key={entry.user} className="lb-podium-slot" style={{ animationDelay: `${idx * 0.15}s` }}>
                      <div
                        className="lb-podium-card"
                        style={{
                          background: podiumGradients[podiumIdx],
                          minHeight: podiumHeights[idx] || "150px",
                        }}
                      >
                        <div className="lb-podium-medal">{medals[actualRank - 1]}</div>
                        <div className="lb-podium-rank">#{actualRank}</div>
                        <div className="lb-podium-user">{entry.user}</div>
                        <div className="lb-podium-points">
                          {entry.dataset_points.toLocaleString()}
                          <span className="lb-podium-points-label"> pts</span>
                        </div>
                        {entry.last_activity && (
                          <div className="lb-podium-activity">{timeSince(entry.last_activity)}</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Single leader card (if only 1 person) */}
            {top3.length === 1 && (
              <div className={`lb-single-leader ${animateIn ? "lb-animate-in" : ""}`}>
                <div
                  className="lb-podium-card"
                  style={{ background: podiumGradients[0], minHeight: "200px", maxWidth: "320px", margin: "0 auto" }}
                >
                  <div className="lb-podium-medal">🥇</div>
                  <div className="lb-podium-rank">#1</div>
                  <div className="lb-podium-user">{top3[0].user}</div>
                  <div className="lb-podium-points">
                    {top3[0].dataset_points.toLocaleString()}
                    <span className="lb-podium-points-label"> pts</span>
                  </div>
                </div>
              </div>
            )}

            {/* Full Rankings Table */}
            <div className={`lb-rankings ${animateIn ? "lb-animate-in" : ""}`}>
              <h3 className="lb-rankings-title">Full Rankings</h3>
              <div className="lb-table">
                <div className="lb-table-header">
                  <span className="lb-col-rank">Rank</span>
                  <span className="lb-col-user">Contributor</span>
                  <span className="lb-col-points">Points</span>
                  <span className="lb-col-bar">Progress</span>
                  <span className="lb-col-activity">Last Active</span>
                </div>
                {data.map((row, idx) => (
                  <div
                    key={row.user}
                    className={`lb-table-row ${idx < 3 ? "lb-row-top3" : ""}`}
                    style={{ animationDelay: `${0.3 + idx * 0.05}s` }}
                  >
                    <span className="lb-col-rank">
                      {idx < 3 ? (
                        <span className="lb-rank-badge" data-rank={idx + 1}>{medals[idx]}</span>
                      ) : (
                        <span className="lb-rank-num">#{row.rank}</span>
                      )}
                    </span>
                    <span className="lb-col-user">
                      <span className="lb-avatar">{row.user.charAt(0).toUpperCase()}</span>
                      <span className="lb-username">{row.user}</span>
                    </span>
                    <span className="lb-col-points">
                      <strong>{row.dataset_points.toLocaleString()}</strong>
                    </span>
                    <span className="lb-col-bar">
                      <div className="lb-progress-track">
                        <div
                          className="lb-progress-fill"
                          style={{
                            width: `${getBarPercent(row.dataset_points)}%`,
                            background: idx === 0
                              ? "linear-gradient(90deg, #f093fb, #f5576c)"
                              : idx === 1
                                ? "linear-gradient(90deg, #667eea, #764ba2)"
                                : idx === 2
                                  ? "linear-gradient(90deg, #4facfe, #00f2fe)"
                                  : "linear-gradient(90deg, #a8edea, #fed6e3)",
                            animationDelay: `${0.5 + idx * 0.08}s`,
                          }}
                        />
                      </div>
                    </span>
                    <span className="lb-col-activity">
                      {row.last_activity ? timeSince(row.last_activity) : "—"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
