/**
 * 极限捞鱼 — 计分计算（纯函数）
 *
 * 核心原则（PRD §5）：网得越密，收益越高，避免用户无脑拉大网。
 * - 基础：每捕获 1 条鱼 +scorePerFish
 * - 密度奖励：density = fishCount / selectedCellCount，越高 bonus 越大
 * - Combo 里程碑：达到 3/5/8 等额外加分（同局各一次）
 * - PERFECT NET：选区全部为鱼 → +perfectBonus（由引擎在 density==1 时触发）
 */
import type { DensityBonusTier } from './types'

/** 密度奖励：按档位给 fishCount × factor，未达任何档位为 0 */
export function densityBonus(
  density: number,
  fishCount: number,
  tiers: DensityBonusTier[],
): number {
  let factor = 0
  for (const t of tiers) {
    if (density >= t.minDensity) {
      factor = t.factor
      break
    }
  }
  return fishCount * factor
}

/** Combo 里程碑奖励：达到里程碑且同局首次时发放 */
export function comboMilestoneBonus(
  combo: number,
  milestones: { combo: number; bonus: number }[],
  awarded: Set<number>,
): number {
  let bonus = 0
  for (const m of milestones) {
    if (combo === m.combo && !awarded.has(m.combo)) {
      awarded.add(m.combo)
      bonus += m.bonus
    }
  }
  return bonus
}
