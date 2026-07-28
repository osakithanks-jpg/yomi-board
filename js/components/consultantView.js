/**
 * 選考進捗・ヨミ管理システム - コンサル別画面コンポーネント (四半期(Q)目標管理 & 2025年度4Q連動)
 */

import { store } from '../store.js';
import {
  getFiscalYear,
  getFiscalQuarter,
  getQuarterDateRange,
  getQuarterFromYearMonth,
  getSelectionAlerts,
  calculateCandidateYomiTotals
} from '../utils/yomiCalculations.js';
import { PHASES } from '../constants.js';

export function renderConsultantView(container, initialConsultantId = '', { onOpenDetail }) {
  const consultants = store.getConsultants();
  let activeConsultantId = initialConsultantId || store.getCurrentConsultant().consultantId;
  let activeRoleType = 'CA'; // 'CA' | 'RA'

  // 現在日からのデフォルト年度・Q判定 (指示書 13項)
  let selectedFiscalYear = getFiscalYear(new Date());
  let selectedQuarter = getFiscalQuarter(new Date());

  function updateView() {
    const activeCons = consultants.find(c => c.consultantId === activeConsultantId) || consultants[0];
    const selections = store.getSelections();
    const companies = store.getCompanies();
    const jobs = store.getJobs();
    const candidates = store.getCandidates();
    const histories = store.getHistories();

    const companiesMap = new Map(companies.map(c => [c.companyId, c]));
    const candidatesMap = new Map(candidates.map(c => [c.candidateId, c]));
    const jobsMap = new Map(jobs.map(j => [j.jobId, j]));

    const qRange = getQuarterDateRange(selectedFiscalYear, selectedQuarter);
    const startDate = new Date(qRange.startDate);
    const endDate = new Date(qRange.endDate);
    endDate.setHours(23, 59, 59, 999);

    // Q目標データの取得 (指示書 13項)
    const qTargets = store.getQTargets(selectedFiscalYear, selectedQuarter);
    const targetObj = qTargets.find(t => t.consultantId === activeCons.consultantId);
    const myQTarget = targetObj ? Number(targetObj.targetCount || 0) : (activeCons.roleType === 'ADMIN' ? 5 : (activeCons.roleType === 'CA' ? 4 : 3));

    // CA / RA による担当案件抽出
    const myAllSelections = selections.filter(s => {
      if (s.isArchived) return false;
      return activeRoleType === 'CA' 
        ? (s.caId === activeCons.consultantId || s.caConsultantId === activeCons.consultantId)
        : (s.raId === activeCons.consultantId || s.raConsultantId === activeCons.consultantId);
    });

    // 1. Q承諾実績 (指示書 13項)
    const myAcceptedSelections = myAllSelections.filter(s => {
      if (s.phase !== '内定承諾' && s.phase !== '入社予定') return false;
      const acceptDateStr = s.selectionEndDate || s.phaseUpdatedAt || s.updatedAt;
      if (!acceptDateStr) return false;
      const aDate = new Date(acceptDateStr);
      return aDate >= startDate && aDate <= endDate;
    });
    const myAcceptedCount = myAcceptedSelections.length;

    // 2. Q進行中ヨミ (完了見込み月が対象Qに含まれる進行中案件) (指示書 13項)
    const myInProgSelectionsInQ = myAllSelections.filter(s => {
      if (s.phase === '選考終了' || s.phase === '内定承諾' || s.phase === '入社予定') return false;
      if (!s.expectedCompletionMonth) return false;
      const qInfo = getQuarterFromYearMonth(s.expectedCompletionMonth);
      if (!qInfo) return false;
      if (selectedQuarter === 'ALL') return qInfo.fiscalYear === selectedFiscalYear;
      return qInfo.fiscalYear === selectedFiscalYear && qInfo.quarter === selectedQuarter;
    });

    const myInProgYomi = Math.round(myInProgSelectionsInQ.reduce((sum, s) => sum + Number(s.yomi || 0), 0) * 100) / 100;

    // 3. Q着地見込み, 4. 不足, 5. 達成率 (指示書 13項)
    const myForecast = Math.round((myAcceptedCount + myInProgYomi) * 100) / 100;
    const myShortage = Math.max(0, Math.round((myQTarget - myForecast) * 100) / 100);
    const myRate = myQTarget > 0 ? Math.round((myForecast / myQTarget) * 1000) / 10 : 0;

    // フェーズ別件数集計
    const phaseCounts = PHASES.map(p => ({
      phase: p,
      count: myInProgSelectionsInQ.filter(s => s.phase === p).length
    }));

    container.innerHTML = `
      <div class="space-y-6">
        <!-- ヘッダー & コンサル切り替え -->
        <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div class="flex items-center space-x-3">
            <div class="w-12 h-12 bg-indigo-600 text-white rounded-full font-black text-lg flex items-center justify-center shadow">
              ${activeCons.name.charAt(0)}
            </div>
            <div>
              <h2 class="text-lg font-bold text-slate-800">${activeCons.name} の選考進捗・Q目標管理</h2>
              <p class="text-xs text-slate-500">${activeCons.team} / ${activeCons.email}</p>
            </div>
          </div>

          <div class="flex items-center space-x-3 text-xs">
            <!-- 年度 ＆ Q選択ドロップダウン (指示書 13項) -->
            <select id="select-cons-fy" class="bg-slate-50 border border-slate-300 font-bold rounded px-2.5 py-1.5 text-slate-800">
              <option value="2025" ${selectedFiscalYear === 2025 ? 'selected' : ''}>2025年度</option>
              <option value="2026" ${selectedFiscalYear === 2026 ? 'selected' : ''}>2026年度</option>
            </select>

            <select id="select-cons-q" class="bg-slate-50 border border-slate-300 font-bold rounded px-2.5 py-1.5 text-indigo-900">
              <option value="Q1" ${selectedQuarter === 'Q1' ? 'selected' : ''}>1Q (10-12月)</option>
              <option value="Q2" ${selectedQuarter === 'Q2' ? 'selected' : ''}>2Q (1-3月)</option>
              <option value="Q3" ${selectedQuarter === 'Q3' ? 'selected' : ''}>3Q (4-6月)</option>
              <option value="Q4" ${selectedQuarter === 'Q4' ? 'selected' : ''}>4Q (7-9月)</option>
              <option value="ALL" ${selectedQuarter === 'ALL' ? 'selected' : ''}>年度通期</option>
            </select>

            <!-- CA / RA 切替 -->
            <div class="bg-slate-100 p-1 rounded-lg flex items-center border border-slate-200 font-bold">
              <button id="btn-role-ca" class="px-3 py-1 rounded transition ${activeRoleType === 'CA' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600'}">
                CA担当
              </button>
              <button id="btn-role-ra" class="px-3 py-1 rounded transition ${activeRoleType === 'RA' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600'}">
                RA担当
              </button>
            </div>

            <select id="select-consultant-change" class="bg-slate-50 border border-slate-300 font-bold rounded px-3 py-2 text-slate-800 focus:outline-none">
              ${consultants.map(c => `<option value="${c.consultantId}" ${c.consultantId === activeCons.consultantId ? 'selected' : ''}>${c.name} (${c.team})</option>`).join('')}
            </select>
          </div>
        </div>

        <!-- Q KPIカード (指示書 13項) -->
        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <div class="bg-slate-900 text-white p-4 rounded-xl border border-slate-800">
            <div class="text-xs text-slate-400 font-semibold">個人Q目標</div>
            <div class="text-2xl font-black mt-1">${myQTarget}<span class="text-xs font-normal text-slate-400 ml-1">件</span></div>
          </div>

          <div class="bg-emerald-50 border border-emerald-200 p-4 rounded-xl">
            <div class="text-xs font-bold text-emerald-800">Q承諾実績</div>
            <div class="text-2xl font-black text-emerald-600 mt-1">${myAcceptedCount}<span class="text-xs font-normal text-emerald-700 ml-1">件</span></div>
          </div>

          <div class="bg-indigo-50 border border-indigo-200 p-4 rounded-xl">
            <div class="text-xs font-bold text-indigo-800">Q進行中ヨミ合計</div>
            <div class="text-2xl font-black text-indigo-600 mt-1">${myInProgYomi}<span class="text-xs font-normal text-indigo-700 ml-1">件</span></div>
          </div>

          <div class="bg-purple-50 border border-purple-200 p-4 rounded-xl">
            <div class="text-xs font-bold text-purple-800">Q着地見込み</div>
            <div class="text-2xl font-black text-purple-600 mt-1">${myForecast}<span class="text-xs font-normal text-purple-700 ml-1">件</span></div>
          </div>

          <div class="bg-rose-50 border border-rose-200 p-4 rounded-xl">
            <div class="text-xs font-bold text-rose-800">Q不足ヨミ</div>
            <div class="text-2xl font-black text-rose-600 mt-1">${myShortage}<span class="text-xs font-normal text-rose-700 ml-1">件</span></div>
          </div>

          <div class="bg-amber-50 border border-amber-200 p-4 rounded-xl">
            <div class="text-xs font-bold text-amber-800">Q見込み達成率</div>
            <div class="text-2xl font-black text-amber-600 mt-1">${myRate}%</div>
          </div>
        </div>

        <!-- フェーズ別件数プログレス -->
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-3">
          <h3 class="font-bold text-slate-800 text-xs">対象Q フェーズ別案件内訳 (${qRange.label})</h3>
          <div class="grid grid-cols-2 sm:grid-cols-5 md:grid-cols-10 gap-2 text-center text-xs">
            ${phaseCounts.map(item => `
              <div class="bg-slate-50 border border-slate-200 p-2 rounded-lg">
                <div class="text-[10px] text-slate-500 font-semibold line-clamp-1" title="${item.phase}">${item.phase}</div>
                <div class="text-base font-black text-indigo-600 mt-1">${item.count}</div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- 担当案件一覧テーブル (指示書 13項) -->
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden space-y-3">
          <div class="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <h3 class="font-bold text-slate-800 text-sm">
              対象Q 担当案件一覧 (${myInProgSelectionsInQ.length}件)
            </h3>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs">
              <thead class="bg-slate-900 text-slate-200 font-semibold border-b border-slate-800">
                <tr>
                  <th class="px-4 py-3">候補者名</th>
                  <th class="px-4 py-3">企業名</th>
                  <th class="px-4 py-3">求人・ポジション</th>
                  <th class="px-3 py-3">選考フェーズ</th>
                  <th class="px-3 py-3">進行状態</th>
                  <th class="px-3 py-3 text-right">ヨミ</th>
                  <th class="px-3 py-3">完了見込み月</th>
                  <th class="px-3 py-3 text-center">操作</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-200">
                ${myInProgSelectionsInQ.length === 0 ? `
                  <tr><td colspan="8" class="text-center py-8 text-slate-400">対象Qに着地見込みの選考案件がありません。</td></tr>
                ` : myInProgSelectionsInQ.map(s => {
                  const cand = candidatesMap.get(s.candidateId);
                  const comp = companiesMap.get(s.companyId);
                  const job = jobsMap.get(s.jobId);

                  return `
                    <tr class="hover:bg-slate-50 transition">
                      <td class="px-4 py-2.5 font-bold text-slate-900">${cand ? cand.name : s.candidateName}</td>
                      <td class="px-4 py-2.5 font-medium text-slate-800">${comp ? comp.name : s.companyName}</td>
                      <td class="px-4 py-2.5 text-slate-600">${job ? job.title : s.jobName}</td>
                      <td class="px-3 py-2.5 font-semibold text-indigo-700">${s.phase}</td>
                      <td class="px-3 py-2.5 text-slate-700">${s.progressStatus}</td>
                      <td class="px-3 py-2.5 text-right font-black text-indigo-600">${s.yomi * 100}%</td>
                      <td class="px-3 py-2.5 font-mono text-slate-700 font-bold">${s.expectedCompletionMonth || '-'}</td>
                      <td class="px-3 py-2.5 text-center">
                        <button class="btn-detail px-2.5 py-1 bg-slate-100 hover:bg-indigo-600 hover:text-white rounded text-xs transition" data-id="${s.selectionId}">詳細</button>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    container.querySelector('#select-cons-fy')?.addEventListener('change', (e) => { selectedFiscalYear = parseInt(e.target.value, 10); updateView(); });
    container.querySelector('#select-cons-q')?.addEventListener('change', (e) => { selectedQuarter = e.target.value; updateView(); });
    container.querySelector('#btn-role-ca')?.addEventListener('click', () => { activeRoleType = 'CA'; updateView(); });
    container.querySelector('#btn-role-ra')?.addEventListener('click', () => { activeRoleType = 'RA'; updateView(); });
    container.querySelector('#select-consultant-change')?.addEventListener('change', (e) => { activeConsultantId = e.target.value; updateView(); });

    container.querySelectorAll('.btn-detail').forEach(btn => {
      btn.addEventListener('click', () => onOpenDetail(btn.getAttribute('data-id')));
    });
  }

  updateView();
}
