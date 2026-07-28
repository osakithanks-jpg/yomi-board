/**
 * 選考進捗・ヨミ管理システム - 全体ダッシュボードコンポーネント (CA限定チームQ目標集計 & 所属チーム非表示)
 */

import { store } from '../store.js';
import {
  getFiscalYear,
  getFiscalQuarter,
  getQuarterDateRange,
  calculateUniqueCandidatesCount,
  calculateCandidateYomiTotals,
  getSelectionAlerts,
  getQuarterFromYearMonth
} from '../utils/yomiCalculations.js';

const DASHBOARD_STORAGE_KEY = 'dashboard_active_quarter';

function getSavedDashboardState() {
  try {
    const raw = sessionStorage.getItem(DASHBOARD_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveDashboardState(state) {
  try {
    const current = getSavedDashboardState();
    sessionStorage.setItem(DASHBOARD_STORAGE_KEY, JSON.stringify({ ...current, ...state }));
  } catch (e) {}
}

export function renderDashboard(container, { onNavigateToSelections, onNavigateToConsultant, onNavigateToCompany }) {
  const savedState = getSavedDashboardState();

  const defaultFiscalYear = getFiscalYear(new Date());
  const defaultQuarter = getFiscalQuarter(new Date());

  let selectedFiscalYear = savedState.fiscalYear !== undefined ? parseInt(savedState.fiscalYear, 10) : defaultFiscalYear;
  let selectedQuarter = savedState.quarter !== undefined ? savedState.quarter : defaultQuarter; // 'Q1', 'Q2', 'Q3', 'Q4', 'ALL'

  function updateView() {
    const selections = store.getSelections();
    const consultants = store.getConsultants();
    const companies = store.getCompanies();

    const consultantsMap = new Map(consultants.map(c => [c.consultantId, c]));
    const companiesMap = new Map(companies.map(c => [c.companyId, c]));

    const qRange = getQuarterDateRange(selectedFiscalYear, selectedQuarter);
    const startDate = new Date(qRange.startDate);
    const endDate = new Date(qRange.endDate);
    endDate.setHours(23, 59, 59, 999);

    const qTargets = store.getQTargets(selectedFiscalYear, selectedQuarter);
    const qTargetMap = new Map(qTargets.map(t => [t.consultantId, Number(t.targetCount || 0)]));

    // チームQ目標は CA の個人Q目標だけを合計 (指示書 6-3項)
    const activeCaConsultants = consultants.filter(c => !c.isArchived && (c.roleType === 'CA' || c.role === 'member' && !c.roleType));
    let teamQTarget = activeCaConsultants.reduce((sum, c) => sum + (qTargetMap.get(c.consultantId) || 0), 0);
    if (teamQTarget === 0) teamQTarget = qTargetMap.get('TEAM') || 7;

    // -------------------------------------------------------------
    // 集計ロジック
    // -------------------------------------------------------------

    // 1. Q承諾実績 (対象Q期間内に内定承諾・入社決定となった件数)
    const acceptedSelections = selections.filter(s => {
      if (s.isArchived) return false;
      if (s.phase !== '内定承諾' && s.phase !== '入社予定') return false;

      const acceptDateStr = s.selectionEndDate || s.phaseUpdatedAt || s.updatedAt;
      if (!acceptDateStr) return false;

      const aDate = new Date(acceptDateStr);
      return aDate >= startDate && aDate <= endDate;
    });
    const qAcceptedCount = acceptedSelections.length;

    // 2. Q進行中ヨミ
    let qInProgressYomi = 0;
    let missingQCount = 0;

    const inProgressSelectionsInQ = selections.filter(s => {
      if (s.isArchived) return false;
      if (s.phase === '選考終了' || s.phase === '内定承諾' || s.phase === '入社予定') return false;

      if (!s.expectedCompletionMonth) {
        missingQCount++;
        return false;
      }

      const qInfo = getQuarterFromYearMonth(s.expectedCompletionMonth);
      if (!qInfo) {
        missingQCount++;
        return false;
      }

      if (selectedQuarter === 'ALL') {
        return qInfo.fiscalYear === selectedFiscalYear;
      }
      return qInfo.fiscalYear === selectedFiscalYear && qInfo.quarter === selectedQuarter;
    });

    qInProgressYomi = inProgressSelectionsInQ.reduce((sum, s) => sum + Number(s.yomi || 0), 0);
    qInProgressYomi = Math.round(qInProgressYomi * 100) / 100;

    // 3. Q着地見込み
    const qForecastTotal = Math.round((qAcceptedCount + qInProgressYomi) * 100) / 100;

    // 4. Q目標不足ヨミ
    const qShortage = Math.max(0, Math.round((teamQTarget - qForecastTotal) * 100) / 100);

    // 5. Q見込み達成率
    const qAchievementRate = teamQTarget > 0 
      ? Math.round((qForecastTotal / teamQTarget) * 1000) / 10 
      : 0;

    // コンサル別集計 (CAを最優先で表示)
    const activeConsultants = consultants.filter(c => !c.isArchived);
    const consultantStats = activeConsultants.map(c => {
      const isCa = c.roleType === 'CA' || c.role === 'member' && !c.roleType;
      const cTarget = isCa ? (qTargetMap.get(c.consultantId) || 3) : 0; // RA/管理者は目標0 (指示書 6-1項)

      const cAccepted = acceptedSelections.filter(s => s.caId === c.consultantId || s.raId === c.consultantId || s.caConsultantId === c.consultantId).length;

      const cInProgSelections = inProgressSelectionsInQ.filter(s => s.caId === c.consultantId || s.raId === c.consultantId || s.caConsultantId === c.consultantId);
      const cInProgYomi = Math.round(cInProgSelections.reduce((sum, s) => sum + Number(s.yomi || 0), 0) * 100) / 100;

      const cForecast = Math.round((cAccepted + cInProgYomi) * 100) / 100;
      const cShortage = isCa ? Math.max(0, Math.round((cTarget - cForecast) * 100) / 100) : 0;
      const cRate = isCa && cTarget > 0 ? Math.round((cForecast / cTarget) * 1000) / 10 : 0;

      return {
        consultant: c,
        isCa,
        target: cTarget,
        accepted: cAccepted,
        inProgYomi: cInProgYomi,
        forecast: cForecast,
        shortage: cShortage,
        rate: cRate
      };
    });

    // 企業別ヨミ上位
    const companyYomiMap = new Map();
    inProgressSelectionsInQ.forEach(s => {
      const compId = s.companyId;
      const current = companyYomiMap.get(compId) || {
        companyId: compId,
        companyName: s.companyName,
        totalYomi: 0,
        selectionCount: 0
      };
      current.totalYomi += Number(s.yomi || 0);
      current.selectionCount += 1;
      companyYomiMap.set(compId, current);
    });

    const topCompanyYomiList = Array.from(companyYomiMap.values())
      .map(item => ({ ...item, totalYomi: Math.round(item.totalYomi * 100) / 100 }))
      .sort((a, b) => b.totalYomi - a.totalYomi)
      .slice(0, 5);

    saveDashboardState({
      fiscalYear: selectedFiscalYear,
      quarter: selectedQuarter,
      scrollTop: window.scrollY || document.documentElement.scrollTop
    });

    container.innerHTML = `
      <div class="space-y-6">
        <!-- ヘッダー & 期間選択 -->
        <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div class="flex items-center space-x-3">
              <h2 class="text-xl font-bold text-slate-800">全体選考・ヨミダッシュボード</h2>
              <span class="px-3 py-1 bg-indigo-600 text-white font-extrabold rounded-full text-xs shadow-sm">${qRange.label}</span>
            </div>
            <p class="text-xs text-slate-500 mt-1">四半期（Q）CA目標管理・選考進捗リアルタイム集計</p>
          </div>

          <div class="flex items-center space-x-2 text-xs">
            <span class="font-bold text-slate-700">対象年度:</span>
            <select id="select-fiscal-year" class="bg-slate-50 border border-slate-300 font-bold rounded px-2.5 py-1.5 text-slate-800 focus:outline-none">
              <option value="2025" ${selectedFiscalYear === 2025 ? 'selected' : ''}>2025年度 (2025/10〜2026/09)</option>
              <option value="2026" ${selectedFiscalYear === 2026 ? 'selected' : ''}>2026年度 (2026/10〜2027/09)</option>
            </select>

            <span class="font-bold text-slate-700 ml-2">四半期 (Q):</span>
            <div class="flex items-center space-x-1 bg-slate-100 p-1 rounded-lg font-bold border border-slate-200">
              <button data-q="Q1" class="px-2.5 py-1 rounded transition ${selectedQuarter === 'Q1' ? 'bg-indigo-600 text-white shadow' : 'text-slate-600 hover:text-slate-900'}">1Q (10-12月)</button>
              <button data-q="Q2" class="px-2.5 py-1 rounded transition ${selectedQuarter === 'Q2' ? 'bg-indigo-600 text-white shadow' : 'text-slate-600 hover:text-slate-900'}">2Q (1-3月)</button>
              <button data-q="Q3" class="px-2.5 py-1 rounded transition ${selectedQuarter === 'Q3' ? 'bg-indigo-600 text-white shadow' : 'text-slate-600 hover:text-slate-900'}">3Q (4-6月)</button>
              <button data-q="Q4" class="px-2.5 py-1 rounded transition ${selectedQuarter === 'Q4' ? 'bg-indigo-600 text-white shadow' : 'text-slate-600 hover:text-slate-900'}">4Q (7-9月)</button>
              <button data-q="ALL" class="px-2.5 py-1 rounded transition ${selectedQuarter === 'ALL' ? 'bg-indigo-600 text-white shadow' : 'text-slate-600 hover:text-slate-900'}">年度通期</button>
            </div>
          </div>
        </div>

        <!-- 上段集計カード: チームQ目標 (CA限定集計) (指示書 6-3項) -->
        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <!-- 1. チームQ目標 -->
          <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-1">
            <div class="text-xs text-slate-500 font-bold">チームQ目標 (CA合算)</div>
            <div class="text-2xl font-black text-slate-800">${teamQTarget}<span class="text-xs font-normal text-slate-500 ml-1">件</span></div>
            <div class="text-[10px] text-slate-400">CA個人Q目標の合計</div>
          </div>

          <!-- 2. Q承諾実績 -->
          <div class="bg-emerald-50/70 p-4 rounded-xl border border-emerald-200 shadow-sm space-y-1">
            <div class="text-xs text-emerald-800 font-extrabold">Q承諾実績</div>
            <div class="text-2xl font-black text-emerald-600">${qAcceptedCount}<span class="text-xs font-normal text-emerald-700 ml-1">件</span></div>
            <div class="text-[10px] text-emerald-700">期間内の確定承諾数</div>
          </div>

          <!-- 3. Q進行中ヨミ -->
          <div class="bg-indigo-50/70 p-4 rounded-xl border border-indigo-200 shadow-sm space-y-1">
            <div class="text-xs text-indigo-800 font-extrabold">Q進行中ヨミ合計</div>
            <div class="text-2xl font-black text-indigo-600">${qInProgressYomi}<span class="text-xs font-normal text-indigo-700 ml-1">件</span></div>
            <div class="text-[10px] text-indigo-700">着地見込みヨミの積算</div>
          </div>

          <!-- 4. Q着地見込み -->
          <div class="bg-purple-50/70 p-4 rounded-xl border border-purple-200 shadow-sm space-y-1">
            <div class="text-xs text-purple-800 font-extrabold">Q着地見込み</div>
            <div class="text-2xl font-black text-purple-600">${qForecastTotal}<span class="text-xs font-normal text-purple-700 ml-1">件</span></div>
            <div class="text-[10px] text-purple-700">承諾実績 ＋ 進行中ヨミ</div>
          </div>

          <!-- 5. Q目標不足ヨミ -->
          <div class="bg-rose-50/70 p-4 rounded-xl border border-rose-200 shadow-sm space-y-1">
            <div class="text-xs text-rose-800 font-extrabold">Q目標不足ヨミ</div>
            <div class="text-2xl font-black text-rose-600">${qShortage}<span class="text-xs font-normal text-rose-700 ml-1">件</span></div>
            <div class="text-[10px] text-rose-700">目標との乖離Gap</div>
          </div>

          <!-- 6. Q見込み達成率 -->
          <div class="bg-amber-50/70 p-4 rounded-xl border border-amber-200 shadow-sm space-y-1">
            <div class="text-xs text-amber-800 font-extrabold">Q見込み達成率</div>
            <div class="text-2xl font-black text-amber-600">${qAchievementRate}<span class="text-xs font-normal text-amber-700 ml-1">%</span></div>
            <div class="text-[10px] text-amber-700">着地見込み ÷ Q目標</div>
          </div>
        </div>

        <!-- 警告バナー: 着地見込みQ未設定案件 -->
        ${missingQCount > 0 ? `
          <div class="bg-amber-50 border-l-4 border-amber-500 p-4 rounded-r-xl shadow-sm flex items-center justify-between text-xs">
            <div class="flex items-center space-x-2 text-amber-900 font-bold">
              <svg class="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
              <span>注意: 着地見込みQ（完了見込み月）が未設定の進行中案件が <strong>${missingQCount}件</strong> あります。</span>
            </div>
            <button id="btn-fix-missing-q" class="px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded text-xs transition">
              選考一覧で完了見込み月を設定する
            </button>
          </div>
        ` : ''}

        <!-- 2カラムコンテンツ: コンサル別一覧 & 上位企業ヨミ -->
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <!-- 左側: コンサル別目標・実績・ヨミ一覧 (所属チーム列削除対応) (指示書 5-5項, 6-4項) -->
          <div class="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden space-y-3">
            <div class="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 class="font-bold text-slate-800 text-sm">
                コンサル別 Q目標・実績・ヨミ一覧 (${qRange.label})
              </h3>
            </div>

            <div class="overflow-x-auto">
              <table class="w-full text-left text-xs">
                <thead class="bg-slate-900 text-slate-200 font-semibold border-b border-slate-800">
                  <tr>
                    <th class="px-3 py-3">コンサルタント名</th>
                    <th class="px-3 py-3">役割</th>
                    <th class="px-3 py-3 text-right">Q目標</th>
                    <th class="px-3 py-3 text-right">承諾実績</th>
                    <th class="px-3 py-3 text-right">進行中ヨミ</th>
                    <th class="px-3 py-3 text-right">Q着地見込み</th>
                    <th class="px-3 py-3 text-right">Q不足ヨミ</th>
                    <th class="px-3 py-3 text-right">Q達成率</th>
                    <th class="px-3 py-3 text-center">操作</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-200">
                  ${consultantStats.map(stat => {
                    const c = stat.consultant;
                    return `
                      <tr class="hover:bg-indigo-50/40 transition">
                        <td class="px-3 py-3 font-bold text-slate-900 flex items-center gap-1.5">
                          <span>${c.name}</span>
                          ${c.roleType === 'ADMIN' ? '<span class="text-[9px] bg-slate-200 text-slate-800 px-1.5 py-0.5 rounded font-bold">管理者</span>' : ''}
                        </td>
                        <td class="px-3 py-3 text-slate-600 font-medium">${c.roleType || 'CA'}</td>
                        <td class="px-3 py-3 text-right font-bold text-slate-900">${stat.isCa ? `${stat.target}件` : '-'}</td>
                        <td class="px-3 py-3 text-right font-bold text-emerald-600">${stat.accepted}件</td>
                        <td class="px-3 py-3 text-right font-bold text-indigo-600">${stat.inProgYomi}件</td>
                        <td class="px-3 py-3 text-right font-black text-purple-700">${stat.forecast}件</td>
                        <td class="px-3 py-3 text-right font-bold ${stat.shortage > 0 ? 'text-rose-600' : 'text-slate-400'}">${stat.isCa ? `${stat.shortage}件` : '-'}</td>
                        <td class="px-3 py-3 text-right font-black ${stat.rate >= 100 ? 'text-emerald-600' : (stat.rate >= 50 ? 'text-amber-600' : 'text-rose-600')}">
                          ${stat.isCa ? `${stat.rate}%` : '-'}
                        </td>
                        <td class="px-3 py-3 text-center">
                          <button class="btn-goto-consultant px-2.5 py-1 bg-slate-100 hover:bg-indigo-600 hover:text-white rounded text-[11px] font-bold transition" data-id="${c.consultantId}">
                            詳細
                          </button>
                        </td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          </div>

          <!-- 右側: 対象Q 企業別ヨミ合計 上位企業 -->
          <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
            <div class="border-b border-slate-200 pb-3 flex items-center justify-between">
              <h3 class="font-bold text-slate-800 text-sm flex items-center gap-1.5">
                <svg class="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path></svg>
                ${selectedQuarter === 'ALL' ? '通期' : selectedQuarter} 企業別ヨミ上位
              </h3>
              <span class="text-[10px] text-slate-400 font-medium">上位5社</span>
            </div>

            <div class="space-y-3">
              ${topCompanyYomiList.length === 0 ? `
                <div class="text-center py-8 text-slate-400 text-xs">対象Qに着地見込みのヨミがある企業はありません。</div>
              ` : topCompanyYomiList.map((item, idx) => {
                const comp = companiesMap.get(item.companyId);
                const rankBadgeClass = comp ? (comp.rank === 'SS' ? 'bg-rose-100 text-rose-800' : (comp.rank === 'S' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800')) : 'bg-slate-100';

                return `
                  <div class="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between text-xs hover:border-indigo-300 transition cursor-pointer btn-goto-company" data-id="${item.companyId}">
                    <div class="space-y-0.5">
                      <div class="font-bold text-slate-900 flex items-center gap-1.5">
                        <span class="text-slate-400 text-[10px] font-mono">${idx + 1}.</span>
                        <span>${item.companyName}</span>
                        ${comp ? `<span class="px-1.5 py-0.2 text-[9px] font-extrabold rounded ${rankBadgeClass}">${comp.rank}</span>` : ''}
                      </div>
                      <div class="text-[10px] text-slate-500">案件数: ${item.selectionCount}件</div>
                    </div>
                    <div class="text-right">
                      <div class="font-black text-purple-700 text-sm">${item.totalYomi}件</div>
                      <div class="text-[10px] text-indigo-600 font-bold">企業ヨミ</div>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        </div>
      </div>
    `;

    container.querySelector('#select-fiscal-year')?.addEventListener('change', (e) => {
      selectedFiscalYear = parseInt(e.target.value, 10);
      updateView();
    });

    container.querySelectorAll('button[data-q]').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedQuarter = btn.getAttribute('data-q');
        updateView();
      });
    });

    container.querySelector('#btn-fix-missing-q')?.addEventListener('click', () => {
      onNavigateToSelections({ expectedCompletionMonth: '' });
    });

    container.querySelectorAll('.btn-goto-consultant').forEach(btn => {
      btn.addEventListener('click', () => {
        saveDashboardState({ scrollTop: window.scrollY || document.documentElement.scrollTop });
        onNavigateToConsultant(btn.getAttribute('data-id'));
      });
    });

    container.querySelectorAll('.btn-goto-company').forEach(el => {
      el.addEventListener('click', () => {
        saveDashboardState({ scrollTop: window.scrollY || document.documentElement.scrollTop });
        onNavigateToCompany(el.getAttribute('data-id'));
      });
    });
  }

  updateView();
}
