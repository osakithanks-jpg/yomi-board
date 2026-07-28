/**
 * 選考進捗・ヨミ管理システム - ヨミ計算 & 年度・四半期（Q）判定共通ユーティリティ (型安全防御 ＆ 選考終了・内定辞退厳格除外対応)
 */

/**
 * 日付から10月開始の年度（Fiscal Year）を判定
 */
export function getFiscalYear(dateInput = new Date()) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(d.getTime())) return 2025;

  const year = d.getFullYear();
  const month = d.getMonth() + 1; // 1-12

  if (month >= 10) {
    return year;
  } else {
    return year - 1;
  }
}

/**
 * 日付から四半期 (Q1, Q2, Q3, Q4) を判定
 */
export function getFiscalQuarter(dateInput = new Date()) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(d.getTime())) return 'Q4';

  const month = d.getMonth() + 1;
  if (month >= 10 && month <= 12) return 'Q1';
  if (month >= 1 && month <= 3) return 'Q2';
  if (month >= 4 && month <= 6) return 'Q3';
  return 'Q4';
}

/**
 * 年度とQから開始日・終了日・ラベルを取得
 */
export function getQuarterDateRange(fiscalYear, quarter) {
  const fy = parseInt(fiscalYear, 10);
  let startDate = '';
  let endDate = '';
  let label = '';
  let months = [];

  if (quarter === 'Q1') {
    startDate = `${fy}-10-01`;
    endDate = `${fy}-12-31`;
    label = `${fy}年度 1Q (${fy}年10月〜12月)`;
    months = [`${fy}-10`, `${fy}-11`, `${fy}-12`];
  } else if (quarter === 'Q2') {
    startDate = `${fy + 1}-01-01`;
    endDate = `${fy + 1}-03-31`;
    label = `${fy}年度 2Q (${fy + 1}年1月〜3月)`;
    months = [`${fy + 1}-01`, `${fy + 1}-02`, `${fy + 1}-03`];
  } else if (quarter === 'Q3') {
    startDate = `${fy + 1}-04-01`;
    endDate = `${fy + 1}-06-30`;
    label = `${fy}年度 3Q (${fy + 1}年4月〜6月)`;
    months = [`${fy + 1}-04`, `${fy + 1}-05`, `${fy + 1}-06`];
  } else if (quarter === 'Q4') {
    startDate = `${fy + 1}-07-01`;
    endDate = `${fy + 1}-09-30`;
    label = `${fy}年度 4Q (${fy + 1}年7月〜9月)`;
    months = [`${fy + 1}-07`, `${fy + 1}-08`, `${fy + 1}-09`];
  } else {
    // 年度合計
    startDate = `${fy}-10-01`;
    endDate = `${fy + 1}-09-30`;
    label = `${fy}年度 通期 (${fy}年10月〜${fy + 1}年9月)`;
    months = [
      `${fy}-10`, `${fy}-11`, `${fy}-12`,
      `${fy + 1}-01`, `${fy + 1}-02`, `${fy + 1}-03`,
      `${fy + 1}-04`, `${fy + 1}-05`, `${fy + 1}-06`,
      `${fy + 1}-07`, `${fy + 1}-08`, `${fy + 1}-09`
    ];
  }

  return { startDate, endDate, label, months };
}

/**
 * 完了見込み月 (YYYY-MM) から着地見込みQを判定
 */
export function getQuarterFromYearMonth(yearMonthStr) {
  if (!yearMonthStr) return null;
  const match = yearMonthStr.match(/^(\d{4})[-/](\d{1,2})/);
  if (!match) return null;

  const y = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);

  const testDate = new Date(y, m - 1, 15);
  const fiscalYear = getFiscalYear(testDate);
  const quarter = getFiscalQuarter(testDate);

  const qNum = quarter.replace('Q', '');
  return {
    fiscalYear,
    quarter,
    label: `${fiscalYear}年度 ${qNum}Q`
  };
}

/**
 * 重複を除外した候補者実人数（ヘッドカウント）の計算 (指示書 4, 7, 10, 17項)
 */
export function calculateUniqueCandidatesCount(selections, includeEnded = false) {
  const targetSelections = includeEnded 
    ? selections 
    : selections.filter(s => s.phase !== '選考終了' && s.phase !== '内定辞退');
  
  const uniqueCandidateIds = new Set(targetSelections.map(s => s.candidateId));
  return uniqueCandidateIds.size;
}

/**
 * 候補者ごとの案件数およびヨミ合計の算出 (指示書 17, 18項)
 */
export function calculateCandidateYomiTotals(selections) {
  const result = new Map();

  selections.forEach(s => {
    // 選考終了および内定辞退は除外 (指示書 17項)
    if (s.phase === '選考終了' || s.phase === '内定辞退') return;

    const candId = s.candidateId;
    const current = result.get(candId) || {
      candidateId: candId,
      candidateName: s.candidateName,
      caId: s.caId || s.caConsultantId,
      caName: s.caName,
      selectionCount: 0,
      totalYomi: 0,
      selections: []
    };

    current.selectionCount += 1;
    current.totalYomi += Number(s.yomi || 0);
    current.selections.push(s);

    result.set(candId, current);
  });

  return Array.from(result.values()).map(item => ({
    ...item,
    totalYomi: Math.round(item.totalYomi * 100) / 100
  }));
}

/**
 * 選考アラート状態の取得 (型安全防御型実装 & 終了/辞退案件除外)
 */
export function getSelectionAlerts(selection, todayOrComp = new Date(), candidateYomiTotals = []) {
  const alerts = [];

  let today = (todayOrComp instanceof Date && !isNaN(todayOrComp.getTime()))
    ? new Date(todayOrComp)
    : new Date();

  today.setHours(0, 0, 0, 0);

  if (!selection || selection.phase === '選考終了' || selection.phase === '内定辞退') return alerts;

  // 1. 次回予定日超過
  if (selection.nextScheduleDate) {
    const nextDate = new Date(selection.nextScheduleDate);
    if (!isNaN(nextDate.getTime()) && nextDate < today && selection.progressStatus !== '完了') {
      alerts.push({ type: 'expired_action', message: '次回予定日超過', level: 'red' });
    }
  }

  // 2. 結果待ち長期化 (7日以上)
  if (selection.progressStatus === '実施済み・結果待ち' && selection.phaseUpdatedAt) {
    const updatedAt = new Date(selection.phaseUpdatedAt);
    if (!isNaN(updatedAt.getTime())) {
      const diffDays = Math.floor((today - updatedAt) / (1000 * 60 * 60 * 24));
      if (diffDays >= 7) {
        alerts.push({ type: 'waiting_result_long', message: `結果待ち ${diffDays}日目`, level: 'red' });
      } else if (diffDays >= 3) {
        alerts.push({ type: 'waiting_result_medium', message: `結果待ち ${diffDays}日目`, level: 'amber' });
      }
    }
  }

  // 3. 企業対応期限超過
  if (selection.actionDeadline) {
    const dLine = new Date(selection.actionDeadline);
    if (!isNaN(dLine.getTime()) && dLine < today && selection.companyActionStatus !== '完了') {
      alerts.push({ type: 'action_deadline_over', message: '対応期限超過', level: 'red' });
    }
  }

  return alerts;
}
