/**
 * @fileoverview Score Calculator for computing quality scores
 * @module score-calculator
 */

/**
 * Default scoring weights
 */
const DEFAULT_WEIGHTS = {
  taskCompletion: 0.30,
  outputQuality: 0.25,
  toolUtilization: 0.20,
  goalAlignment: 0.15,
  processEfficiency: 0.10
};

/**
 * Grade thresholds
 */
const GRADE_THRESHOLDS = {
  A: 90,
  B: 80,
  C: 70,
  D: 60
};

/**
 * Score Calculator class
 */
export class ScoreCalculator {
  /**
   * @param {Object} [weights] - Custom weights
   */
  constructor(weights = {}) {
    this.weights = { ...DEFAULT_WEIGHTS, ...weights };
    
    // Validate weights sum to 1.0
    const sum = Object.values(this.weights).reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1.0) > 0.01) {
      throw new Error(`Weights must sum to 1.0, got ${sum}`);
    }
  }

  /**
   * Calculate overall score from dimension scores
   * @param {Object} dimensionScores
   * @returns {Object}
   */
  calculateOverall(dimensionScores) {
    let overall = 0;
    const breakdown = {};

    for (const [dimension, weight] of Object.entries(this.weights)) {
      const score = dimensionScores[dimension]?.score || 0;
      const weighted = score * weight;
      overall += weighted;

      breakdown[dimension] = {
        score,
        weight,
        weighted: Math.round(weighted * 100) / 100,
        rationale: dimensionScores[dimension]?.rationale || '',
        strengths: dimensionScores[dimension]?.strengths || [],
        weaknesses: dimensionScores[dimension]?.weaknesses || []
      };
    }

    return {
      overall: Math.round(overall * 100) / 100,
      grade: this.scoreToGrade(overall),
      summary: this.generateSummary(overall, breakdown),
      breakdown
    };
  }

  /**
   * Convert numeric score to letter grade
   * @param {number} score
   * @returns {string}
   */
  scoreToGrade(score) {
    if (score >= GRADE_THRESHOLDS.A) return 'A';
    if (score >= GRADE_THRESHOLDS.B) return 'B';
    if (score >= GRADE_THRESHOLDS.C) return 'C';
    if (score >= GRADE_THRESHOLDS.D) return 'D';
    return 'F';
  }

  /**
   * Get grade description
   * @param {string} grade
   * @returns {string}
   */
  gradeDescription(grade) {
    const descriptions = {
      A: 'Excellent',
      B: 'Good',
      C: 'Satisfactory',
      D: 'Needs Improvement',
      F: 'Unsatisfactory'
    };
    return descriptions[grade] || 'Unknown';
  }

  /**
   * Generate summary text
   * @param {number} overall
   * @param {Object} breakdown
   * @returns {string}
   * @private
   */
  generateSummary(overall, breakdown) {
    const grade = this.scoreToGrade(overall);
    const desc = this.gradeDescription(grade);
    
    // Find strongest and weakest dimensions
    const sorted = Object.entries(breakdown)
      .sort((a, b) => b[1].score - a[1].score);
    
    const strongest = sorted[0];
    const weakest = sorted[sorted.length - 1];

    return `Session achieved an overall score of ${overall.toFixed(1)}/100 (${grade} - ${desc}). ` +
      `Strongest area: ${this.formatDimensionName(strongest[0])} (${strongest[1].score}). ` +
      `Area for improvement: ${this.formatDimensionName(weakest[0])} (${weakest[1].score}).`;
  }

  /**
   * Format dimension name for display
   * @param {string} dimension
   * @returns {string}
   * @private
   */
  formatDimensionName(dimension) {
    return dimension
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, s => s.toUpperCase())
      .trim();
  }

  /**
   * Calculate task completion score from metrics
   * @param {Object} metrics
   * @returns {number}
   */
  calculateTaskCompletionScore(metrics) {
    if (!metrics || metrics.totalTasks === 0) return 0;
    
    const completionRate = metrics.completedCount / metrics.totalTasks;
    const failureRate = metrics.failedCount / metrics.totalTasks;
    
    // Base score from completion rate
    let score = completionRate * 100;
    
    // Penalty for failures
    score -= failureRate * 20;
    
    return Math.max(0, Math.min(100, score));
  }

  /**
   * Calculate output quality score from evaluations
   * @param {Object[]} evaluations
   * @returns {number}
   */
  calculateOutputQualityScore(evaluations) {
    if (!evaluations || evaluations.length === 0) return 50;
    
    let totalScore = 0;
    
    for (const eval_ of evaluations) {
      if (eval_.success) {
        // Start with 85 for success
        let evalScore = 85;
        
        // Bonus for matched criteria
        const criteriaCount = (eval_.criteriaMatched?.length || 0) + (eval_.criteriaUnmatched?.length || 0);
        if (criteriaCount > 0) {
          const matchRate = (eval_.criteriaMatched?.length || 0) / criteriaCount;
          evalScore += matchRate * 15;
        }
        
        // Penalty for issues
        evalScore -= (eval_.issues?.length || 0) * 5;
        
        totalScore += Math.max(0, Math.min(100, evalScore));
      } else {
        // Failed evaluations get 30 base
        totalScore += 30;
      }
    }
    
    return totalScore / evaluations.length;
  }

  /**
   * Calculate tool utilization score
   * @param {Object} taskList
   * @param {Object[]} taskOutputs
   * @returns {number}
   */
  calculateToolUtilizationScore(taskList, taskOutputs) {
    if (!taskList?.tasks || taskList.tasks.length === 0) return 50;
    
    let score = 80; // Base score
    
    // Check if all tasks have valid tool bindings
    const tasksWithTools = taskList.tasks.filter(t => t.tool?.toolName);
    const bindingRate = tasksWithTools.length / taskList.tasks.length;
    
    if (bindingRate < 1.0) {
      score -= (1 - bindingRate) * 30;
    }
    
    // Bonus for variety of tools used
    const toolsUsed = new Set(taskList.tasks.map(t => t.tool?.toolName)).size;
    if (toolsUsed > 1) {
      score += Math.min(10, toolsUsed * 2);
    }
    
    return Math.max(0, Math.min(100, score));
  }

  /**
   * Calculate goal alignment score
   * @param {Object} goals
   * @param {Object[]} evaluations
   * @returns {number}
   */
  calculateGoalAlignmentScore(goals, evaluations) {
    if (!goals?.items || goals.items.length === 0) return 50;
    
    let totalScore = 0;
    
    for (const goal of goals.items) {
      const state = goal.status?.state;
      
      if (state === 'completed') {
        totalScore += 100;
      } else if (state === 'in_progress') {
        totalScore += goal.status?.progress || 50;
      } else if (state === 'failed') {
        totalScore += 20;
      } else {
        totalScore += 40;
      }
    }
    
    return totalScore / goals.items.length;
  }

  /**
   * Calculate process efficiency score
   * @param {Object} metrics
   * @param {Object} executionLog
   * @returns {number}
   */
  calculateProcessEfficiencyScore(metrics, executionLog) {
    let score = 80; // Base score
    
    if (!metrics) return score;
    
    // Efficiency based on completion time per task
    if (metrics.totalTasks > 0 && metrics.totalExecutionTimeMs > 0) {
      const avgTimePerTask = metrics.totalExecutionTimeMs / metrics.totalTasks;
      
      // Under 30s per task is excellent
      if (avgTimePerTask < 30000) {
        score += 15;
      } else if (avgTimePerTask < 60000) {
        score += 10;
      } else if (avgTimePerTask > 120000) {
        score -= 10;
      }
    }
    
    // Check for retries or errors in log
    if (executionLog?.entries) {
      const errors = executionLog.entries.filter(e => e.status === 'error');
      score -= errors.length * 5;
    }
    
    return Math.max(0, Math.min(100, score));
  }
}

export default ScoreCalculator;
