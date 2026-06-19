"use client";

type SyllabusTrackerProps = {
  totalNodes: number;
  unlockedNodes: number;
};

type Milestone = {
  label: string;
  threshold: number;
  gradientFrom: string;
  gradientTo: string;
  dotColor: string;
  dotGlow: string;
};

const MILESTONES: Milestone[] = [
  {
    label: "Explorer",
    threshold: 25,
    gradientFrom: "from-sky-400",
    gradientTo: "to-cyan-400",
    dotColor: "bg-sky-400",
    dotGlow: "rgba(56,189,248,0.9)",
  },
  {
    label: "Researcher",
    threshold: 50,
    gradientFrom: "from-violet-400",
    gradientTo: "to-sky-400",
    dotColor: "bg-violet-400",
    dotGlow: "rgba(167,139,250,0.9)",
  },
  {
    label: "Scholar",
    threshold: 75,
    gradientFrom: "from-fuchsia-400",
    gradientTo: "to-violet-400",
    dotColor: "bg-fuchsia-400",
    dotGlow: "rgba(232,121,249,0.9)",
  },
  {
    label: "Master",
    threshold: 100,
    gradientFrom: "from-amber-400",
    gradientTo: "to-orange-400",
    dotColor: "bg-amber-400",
    dotGlow: "rgba(251,191,36,0.9)",
  },
];

export default function SyllabusTracker({
  totalNodes,
  unlockedNodes,
}: SyllabusTrackerProps) {
  const percentage =
    totalNodes === 0 ? 0 : Math.round((unlockedNodes / totalNodes) * 100);

  const earnedMilestones = MILESTONES.filter((m) => percentage >= m.threshold);
  const currentMilestone =
    earnedMilestones.length > 0
      ? earnedMilestones[earnedMilestones.length - 1]
      : null;

  return (
    <div className="space-y-3 select-none">
      {/* Percentage + milestone label */}
      <div className="flex items-end justify-between">
        <div className="leading-none">
          <span className="text-3xl font-bold tabular-nums text-white">
            {percentage}
          </span>
          <span className="text-sm text-white/30 ml-0.5">%</span>
        </div>
        <div className="text-right">
          {currentMilestone ? (
            <span
              className={`text-xs font-semibold bg-gradient-to-r ${currentMilestone.gradientFrom} ${currentMilestone.gradientTo} bg-clip-text text-transparent`}
            >
              {currentMilestone.label}
            </span>
          ) : (
            <span className="text-xs text-white/20">Locked</span>
          )}
          <div className="text-[10px] text-white/25 mt-0.5 tabular-nums">
            {unlockedNodes} / {totalNodes} nodes
          </div>
        </div>
      </div>

      {/* Progress track */}
      <div className="relative h-1.5 rounded-full bg-white/5 overflow-hidden">
        {/* Glow layer */}
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-violet-400 via-cyan-400 to-blue-400 opacity-40 blur-[3px] transition-all duration-700 ease-out"
          style={{ width: `${percentage}%` }}
        />
        {/* Solid layer */}
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-violet-500 via-cyan-500 to-blue-500 transition-all duration-700 ease-out"
          style={{ width: `${percentage}%` }}
        />
      </div>

      {/* Milestone ticks */}
      <div className="flex justify-between px-0.5">
        {MILESTONES.map((m) => {
          const earned = percentage >= m.threshold;
          return (
            <div key={m.label} className="flex flex-col items-center gap-1">
              <div
                className={`w-1.5 h-1.5 rounded-full transition-all duration-500 ${
                  earned ? m.dotColor : "bg-white/8"
                }`}
                style={
                  earned
                    ? { boxShadow: `0 0 6px ${m.dotGlow}` }
                    : undefined
                }
              />
              <span
                className={`text-[9px] font-medium leading-none transition-colors duration-300 ${
                  earned ? "text-white/40" : "text-white/12"
                }`}
              >
                {m.threshold}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
