/**
 * 국방예산 중점사업 및 신규사업 분석 대시보드 어플리케이션
 */

(function () {
  'use strict';

  // State Management
  const state = {
    data: [],
    sourceName: '기본 데이터 (2027년 국방예산 정부안)',
    activeTab: 'overview', // 'overview' | 'sector' | 'newProjects' | 'table'
    selectedSector: '전체',
    tableSearch: '',
    tableSectorFilter: '전체',
    tableOnlyNew: false,
    sortField: 'no',
    sortAsc: true,
    charts: {}
  };

  // Utility Functions
  const utils = {
    formatNumber(num, decimals = 1) {
      if (num === null || num === undefined || isNaN(num)) return '-';
      if (Number.isInteger(num)) {
        return num.toLocaleString('ko-KR');
      }
      return Number(num).toLocaleString('ko-KR', {
        minimumFractionDigits: 0,
        maximumFractionDigits: decimals
      });
    },

    formatCurrency(num, unit = '억원') {
      if (num === null || num === undefined || isNaN(num)) return '-';
      return `${utils.formatNumber(num)} ${unit}`;
    },

    formatRate(rateText, rateVal) {
      if (rateText === '신규') {
        return '<span class="badge-tag badge-new">신규</span>';
      }
      if (rateVal !== null && !isNaN(rateVal)) {
        const sign = rateVal > 0 ? '+' : '';
        const cls = rateVal >= 0 ? 'badge-increase' : 'badge-decrease';
        return `<span class="badge-tag ${cls}">${sign}${utils.formatNumber(rateVal, 1)}%</span>`;
      }
      return `<span class="badge-tag badge-neutral">${rateText || '-'}</span>`;
    },

    showToast(message, type = 'info') {
      const container = document.getElementById('toast-container');
      if (!container) return;
      const toast = document.createElement('div');
      toast.className = 'toast';
      const icon = type === 'success' ? '✅' : type === 'error' ? '⚠️' : 'ℹ️';
      toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
      container.appendChild(toast);
      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s ease';
        setTimeout(() => toast.remove(), 300);
      }, 3500);
    }
  };

  // Data Processor & Normalizer
  function normalizeRawRows(rawRows) {
    if (!rawRows || !rawRows.length) return [];

    // Find header row
    let headerRowIndex = 0;
    for (let i = 0; i < Math.min(rawRows.length, 5); i++) {
      const row = rawRows[i];
      const joined = (Array.isArray(row) ? row.join(' ') : Object.values(row).join(' ')).toLowerCase();
      if (joined.includes('분야') || joined.includes('사업') || joined.includes('예산')) {
        headerRowIndex = i;
        break;
      }
    }

    const headers = Array.isArray(rawRows[headerRowIndex]) 
      ? rawRows[headerRowIndex] 
      : Object.keys(rawRows[headerRowIndex]);

    // Map column indices or keys
    const colMap = {
      no: -1,
      sector: -1,
      name: -1,
      unit: -1,
      prev: -1,
      curr: -1,
      diff: -1,
      rate: -1,
      desc: -1
    };

    headers.forEach((h, idx) => {
      const str = String(h || '').trim();
      if (/연번|번호|no|id/i.test(str)) colMap.no = idx;
      else if (/분야|중점영역|중점\s*분야|카테고리/i.test(str)) colMap.sector = idx;
      else if (/세부\s*사업|주요\s*지표|사업명|사업내용/i.test(str)) colMap.name = idx;
      else if (/단위|구분/i.test(str)) colMap.unit = idx;
      else if (/2026|전년|과거|기존|prev/i.test(str)) colMap.prev = idx;
      else if (/2027|정부안|당해|금년|curr|본예산/i.test(str)) colMap.curr = idx;
      else if (/증감|차이|diff/i.test(str)) colMap.diff = idx;
      else if (/증가율|증감률|비율|rate|%/i.test(str)) colMap.rate = idx;
      else if (/핵심\s*내용|보도자료|원문|근거|비고|설명|desc/i.test(str)) colMap.desc = idx;
    });

    const parsedData = [];
    for (let i = headerRowIndex + 1; i < rawRows.length; i++) {
      const row = rawRows[i];
      if (!row) continue;

      const getVal = (colIdx, fallbackKey) => {
        if (Array.isArray(row)) {
          return colIdx >= 0 ? row[colIdx] : '';
        } else {
          if (colIdx >= 0 && headers[colIdx]) return row[headers[colIdx]];
          return row[fallbackKey] || '';
        }
      };

      const name = String(getVal(colMap.name, 'name') || '').trim();
      if (!name) continue; // skip blank row

      const parseNum = (val) => {
        if (typeof val === 'number') return val;
        if (!val) return 0;
        const cleaned = String(val).replace(/,/g, '').replace(/억원/g, '').trim();
        const num = parseFloat(cleaned);
        return isNaN(num) ? 0 : num;
      };

      const prev = parseNum(getVal(colMap.prev, 'prev'));
      const curr = parseNum(getVal(colMap.curr, 'curr'));
      let diff = parseNum(getVal(colMap.diff, 'diff'));
      if (diff === 0 && (curr !== 0 || prev !== 0)) {
        diff = Math.round((curr - prev) * 100) / 100;
      }

      const rawRate = String(getVal(colMap.rate, 'rate') || '').trim();
      const desc = String(getVal(colMap.desc, 'desc') || '').trim();

      // Detect New Project
      const isNew = rawRate.includes('신규') || 
                    (prev === 0 && curr > 0) || 
                    desc.startsWith('[신규');

      let rateVal = null;
      let rateText = rawRate;

      if (isNew) {
        rateText = '신규';
      } else if (rawRate) {
        const cleanRate = rawRate.replace('%', '').trim();
        const parsedFloat = parseFloat(cleanRate);
        if (!isNaN(parsedFloat)) {
          // If fraction like 0.349 instead of 34.9%
          rateVal = parsedFloat < 1.0 && rawRate.indexOf('%') === -1 ? parsedFloat * 100 : parsedFloat;
          rateText = `${utils.formatNumber(rateVal, 1)}%`;
        }
      } else if (prev > 0) {
        rateVal = Math.round(((curr - prev) / prev) * 1000) / 10;
        rateText = `${utils.formatNumber(rateVal, 1)}%`;
      }

      const sector = String(getVal(colMap.sector, 'sector') || '기타 분야').trim();
      const unit = String(getVal(colMap.unit, 'unit') || '억원').trim();
      const noVal = getVal(colMap.no, 'no');
      const no = parseInt(noVal, 10) || (parsedData.length + 1);

      parsedData.push({
        no,
        sector,
        name,
        unit,
        prev,
        curr,
        diff,
        rateText,
        rateVal,
        isNew,
        desc
      });
    }

    return parsedData;
  }

  // App Initialization
  function initApp() {
    state.data = window.DEFAULT_BUDGET_DATA.slice();
    setupEventHandlers();
    renderAll();
  }

  // Event Handlers Setup
  function setupEventHandlers() {
    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tab = e.currentTarget.dataset.tab;
        switchTab(tab);
      });
    });

    // File Upload Modal Trigger
    const btnUpload = document.getElementById('btn-open-upload');
    const modal = document.getElementById('upload-modal');
    const btnCloseModal = document.getElementById('btn-close-modal');
    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('file-input');

    if (btnUpload && modal) {
      btnUpload.addEventListener('click', () => modal.classList.add('active'));
    }

    if (btnCloseModal && modal) {
      btnCloseModal.addEventListener('click', () => modal.classList.remove('active'));
    }

    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.remove('active');
      });
    }

    // Drag and Drop
    if (dropzone && fileInput) {
      dropzone.addEventListener('click', () => fileInput.click());
      
      ['dragenter', 'dragover'].forEach(name => {
        dropzone.addEventListener(name, (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropzone.classList.add('dragover');
        });
      });

      ['dragleave', 'drop'].forEach(name => {
        dropzone.addEventListener(name, (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropzone.classList.remove('dragover');
        });
      });

      dropzone.addEventListener('drop', (e) => {
        const files = e.dataTransfer.files;
        if (files.length) handleFile(files[0]);
      });

      fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) handleFile(e.target.files[0]);
      });
    }

    // Restore Default Data Button
    const btnReset = document.getElementById('btn-reset-data');
    if (btnReset) {
      btnReset.addEventListener('click', () => {
        state.data = window.DEFAULT_BUDGET_DATA.slice();
        state.sourceName = '기본 데이터 (2027년 국방예산 정부안)';
        renderAll();
        utils.showToast('기본 2027년 국방예산 데이터로 복원되었습니다.', 'success');
      });
    }

    // Table Search & Filter Controls
    const searchInput = document.getElementById('table-search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        state.tableSearch = e.target.value.toLowerCase().trim();
        renderTable();
      });
    }

    const sectorSelect = document.getElementById('table-sector-select');
    if (sectorSelect) {
      sectorSelect.addEventListener('change', (e) => {
        state.tableSectorFilter = e.target.value;
        renderTable();
      });
    }

    const onlyNewCheckbox = document.getElementById('table-only-new');
    if (onlyNewCheckbox) {
      onlyNewCheckbox.addEventListener('change', (e) => {
        state.tableOnlyNew = e.target.checked;
        renderTable();
      });
    }

    // Table Column Sorting
    document.querySelectorAll('th[data-sort]').forEach(th => {
      th.addEventListener('click', (e) => {
        const field = e.currentTarget.dataset.sort;
        if (state.sortField === field) {
          state.sortAsc = !state.sortAsc;
        } else {
          state.sortField = field;
          state.sortAsc = true;
        }
        renderTable();
      });
    });

    // Export Buttons
    const btnExportExcel = document.getElementById('btn-export-excel');
    if (btnExportExcel) {
      btnExportExcel.addEventListener('click', exportToExcel);
    }

    const btnExportCsv = document.getElementById('btn-export-csv');
    if (btnExportCsv) {
      btnExportCsv.addEventListener('click', exportToCsv);
    }

    // Print Button
    const btnPrint = document.getElementById('btn-print');
    if (btnPrint) {
      btnPrint.addEventListener('click', () => window.print());
    }
  }

  // Handle uploaded file (Excel or CSV)
  function handleFile(file) {
    const modal = document.getElementById('upload-modal');
    const reader = new FileReader();

    reader.onload = function (e) {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        
        // Find best sheet (look for '중점' or default to first)
        let sheetName = workbook.SheetNames[0];
        const match = workbook.SheetNames.find(s => s.includes('중점') || s.includes('사업') || s.includes('예산'));
        if (match) sheetName = match;

        const worksheet = workbook.Sheets[sheetName];
        const rawJson = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        const normalized = normalizeRawRows(rawJson);
        if (normalized.length === 0) {
          utils.showToast('파일에서 유효한 사업 데이터를 찾을 수 없습니다. 컬럼 양식을 확인해주세요.', 'error');
          return;
        }

        state.data = normalized;
        state.sourceName = `${file.name} (${normalized.length}건 로드됨)`;
        if (modal) modal.classList.remove('active');
        renderAll();
        utils.showToast(`'${file.name}' 파일이 성공적으로 로드되었습니다!`, 'success');
      } catch (err) {
        console.error(err);
        utils.showToast(`파일 파싱 오류: ${err.message}`, 'error');
      }
    };

    reader.readAsArrayBuffer(file);
  }

  // Tab Switching
  function switchTab(tab) {
    state.activeTab = tab;
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    document.querySelectorAll('.tab-content-panel').forEach(panel => {
      panel.style.display = panel.id === `tab-panel-${tab}` ? 'block' : 'none';
    });

    // Re-render corresponding view
    if (tab === 'overview') renderOverview();
    else if (tab === 'sector') renderSectorView();
    else if (tab === 'newProjects') renderNewProjectsView();
    else if (tab === 'table') renderTable();
  }

  // Master Render
  function renderAll() {
    renderStatusBar();
    renderKpis();
    renderOverview();
    renderSectorView();
    renderNewProjectsView();
    renderTable();
  }

  function renderStatusBar() {
    const statusTextEl = document.getElementById('status-source-text');
    if (statusTextEl) {
      statusTextEl.textContent = state.sourceName;
    }
  }

  // Compute aggregated statistics
  function computeStats(data) {
    let totalPrev = 0;
    let totalCurr = 0;
    let totalDiff = 0;
    let newProjectsCount = 0;
    let newProjectsCurrSum = 0;
    const sectorsMap = {};

    data.forEach(item => {
      totalPrev += item.prev;
      totalCurr += item.curr;
      totalDiff += item.diff;

      if (item.isNew) {
        newProjectsCount++;
        newProjectsCurrSum += item.curr;
      }

      if (!sectorsMap[item.sector]) {
        sectorsMap[item.sector] = {
          name: item.sector,
          prevSum: 0,
          currSum: 0,
          diffSum: 0,
          count: 0,
          newCount: 0,
          newSum: 0,
          projects: []
        };
      }

      const s = sectorsMap[item.sector];
      s.prevSum += item.prev;
      s.currSum += item.curr;
      s.diffSum += item.diff;
      s.count++;
      if (item.isNew) {
        s.newCount++;
        s.newSum += item.curr;
      }
      s.projects.push(item);
    });

    const overallRate = totalPrev > 0 ? (totalDiff / totalPrev) * 100 : 0;
    const sectorsList = Object.values(sectorsMap).sort((a, b) => b.currSum - a.currSum);

    return {
      totalPrev,
      totalCurr,
      totalDiff,
      overallRate,
      newProjectsCount,
      newProjectsCurrSum,
      sectorsList,
      sectorsMap,
      totalCount: data.length
    };
  }

  // Render Top KPI Cards
  function renderKpis() {
    const stats = computeStats(state.data);

    document.getElementById('kpi-total-curr').textContent = utils.formatNumber(stats.totalCurr);
    document.getElementById('kpi-total-prev').textContent = utils.formatNumber(stats.totalPrev);
    document.getElementById('kpi-total-diff').textContent = (stats.totalDiff >= 0 ? '+' : '') + utils.formatNumber(stats.totalDiff);
    document.getElementById('kpi-total-rate').textContent = (stats.overallRate >= 0 ? '+' : '') + utils.formatNumber(stats.overallRate, 1) + '%';
    
    document.getElementById('kpi-new-count').textContent = stats.newProjectsCount;
    document.getElementById('kpi-new-sum').textContent = utils.formatNumber(stats.newProjectsCurrSum);

    // Update Tab Badges
    const badgeAll = document.getElementById('badge-tab-all');
    if (badgeAll) badgeAll.textContent = stats.totalCount;

    const badgeSector = document.getElementById('badge-tab-sector');
    if (badgeSector) badgeSector.textContent = stats.sectorsList.length;

    const badgeNew = document.getElementById('badge-tab-new');
    if (badgeNew) badgeNew.textContent = stats.newProjectsCount;
  }

  // Helper to destroy and rebuild chart
  function createOrUpdateChart(id, config) {
    if (state.charts[id]) {
      state.charts[id].destroy();
    }
    const canvas = document.getElementById(id);
    if (!canvas) return null;
    state.charts[id] = new Chart(canvas, config);
    return state.charts[id];
  }

  // View 1: Overview
  function renderOverview() {
    const stats = computeStats(state.data);
    const sectors = stats.sectorsList;

    // 1. Sector Doughnut Chart (2027 Budget distribution)
    const donutColors = [
      '#1e3a8a', '#0284c7', '#0e7490', '#6d28d9',
      '#d97706', '#10b981', '#e11d48', '#64748b', '#f59e0b'
    ];

    createOrUpdateChart('chart-overview-sector-donut', {
      type: 'doughnut',
      data: {
        labels: sectors.map(s => s.name),
        datasets: [{
          data: sectors.map(s => s.currSum),
          backgroundColor: donutColors.slice(0, sectors.length),
          borderWidth: 2,
          borderColor: '#ffffff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              boxWidth: 12,
              font: { size: 11, family: 'Pretendard, sans-serif' }
            }
          },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                const val = ctx.raw;
                const pct = ((val / stats.totalCurr) * 100).toFixed(1);
                return ` ${ctx.label}: ${utils.formatNumber(val)} 억원 (${pct}%)`;
              }
            }
          }
        },
        cutout: '62%'
      }
    });

    // 2. YoY Comparison Grouped Bar Chart (2026 vs 2027)
    createOrUpdateChart('chart-overview-yoy-bar', {
      type: 'bar',
      data: {
        labels: sectors.map(s => s.name.replace(/^[①-⑧]\s*/, '')),
        datasets: [
          {
            label: '2026년 예산',
            data: sectors.map(s => s.prevSum),
            backgroundColor: '#94a3b8',
            borderRadius: 4
          },
          {
            label: '2027년 정부안',
            data: sectors.map(s => s.currSum),
            backgroundColor: '#2563eb',
            borderRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            ticks: {
              font: { size: 11, family: 'Pretendard, sans-serif' },
              maxRotation: 25,
              minRotation: 0
            },
            grid: { display: false }
          },
          y: {
            ticks: {
              callback: v => `${utils.formatNumber(v)} 억`
            },
            grid: { color: '#f1f5f9' }
          }
        },
        plugins: {
          legend: { position: 'top' },
          tooltip: {
            callbacks: {
              label: ctx => ` ${ctx.dataset.label}: ${utils.formatCurrency(ctx.raw)}`
            }
          }
        }
      }
    });

    // 3. Top Net Increase Projects (증감액 상위 사업 TOP 6)
    const topDiffProjects = [...state.data]
      .sort((a, b) => b.diff - a.diff)
      .slice(0, 6);

    createOrUpdateChart('chart-top-diff', {
      type: 'bar',
      data: {
        labels: topDiffProjects.map(p => p.name.length > 15 ? p.name.slice(0, 14) + '…' : p.name),
        datasets: [{
          label: '증감액 (억원)',
          data: topDiffProjects.map(p => p.diff),
          backgroundColor: '#059669',
          borderRadius: 4
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            ticks: { callback: v => `+${utils.formatNumber(v)}` },
            grid: { color: '#f1f5f9' }
          },
          y: { grid: { display: false } }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: ctx => topDiffProjects[ctx[0].dataIndex].name,
              label: ctx => `증감액: +${utils.formatCurrency(ctx.raw)} (${topDiffProjects[ctx.dataIndex].rateText})`
            }
          }
        }
      }
    });

    // 4. Sector Budget & Growth Summary Table
    const tbody = document.getElementById('overview-sector-tbody');
    if (tbody) {
      tbody.innerHTML = sectors.map((s, idx) => {
        const pctOfTotal = ((s.currSum / stats.totalCurr) * 100).toFixed(1);
        const yoyRate = s.prevSum > 0 ? ((s.diffSum / s.prevSum) * 100).toFixed(1) : '신규';
        return `
          <tr>
            <td><strong>${s.name}</strong></td>
            <td class="text-right">${utils.formatNumber(s.prevSum)} 억</td>
            <td class="text-right"><strong>${utils.formatNumber(s.currSum)} 억</strong></td>
            <td class="text-right text-success" style="color: #059669; font-weight:700;">+${utils.formatNumber(s.diffSum)} 억</td>
            <td class="text-center">${yoyRate === '신규' ? '<span class="badge-tag badge-new">신규</span>' : `<span class="badge-tag badge-increase">+${yoyRate}%</span>`}</td>
            <td class="text-center">
              <span class="badge-tag badge-neutral">${s.count}개</span>
              ${s.newCount > 0 ? `<span class="badge-tag badge-new">신규 ${s.newCount}</span>` : ''}
            </td>
            <td class="text-right" style="font-weight:600; color: #1e40af;">${pctOfTotal}%</td>
          </tr>
        `;
      }).join('');
    }
  }

  // View 2: Sector Deep Dive
  function renderSectorView() {
    const stats = computeStats(state.data);
    const sectors = stats.sectorsList;

    // Default select first sector if '전체' or invalid
    if (state.selectedSector === '전체' && sectors.length > 0) {
      state.selectedSector = sectors[0].name;
    }

    // Render Sector Filter Chips
    const chipsContainer = document.getElementById('sector-chips-container');
    if (chipsContainer) {
      chipsContainer.innerHTML = sectors.map(s => `
        <button class="sector-chip ${s.name === state.selectedSector ? 'active' : ''}" data-sector="${s.name}">
          <span>${s.name}</span>
          <span class="chip-badge">${s.count}개</span>
        </button>
      `).join('');

      chipsContainer.querySelectorAll('.sector-chip').forEach(btn => {
        btn.addEventListener('click', (e) => {
          state.selectedSector = e.currentTarget.dataset.sector;
          renderSectorView();
        });
      });
    }

    const selectedSecData = stats.sectorsMap[state.selectedSector] || sectors[0];
    if (!selectedSecData) return;

    // Update Sector Details Info
    document.getElementById('sec-title').textContent = selectedSecData.name;
    document.getElementById('sec-curr-sum').textContent = utils.formatCurrency(selectedSecData.currSum);
    document.getElementById('sec-prev-sum').textContent = utils.formatCurrency(selectedSecData.prevSum);
    document.getElementById('sec-diff-sum').textContent = `+${utils.formatCurrency(selectedSecData.diffSum)}`;
    
    const secRate = selectedSecData.prevSum > 0 
      ? `+${((selectedSecData.diffSum / selectedSecData.prevSum) * 100).toFixed(1)}%` 
      : '신규';
    document.getElementById('sec-rate').textContent = secRate;
    document.getElementById('sec-project-count').textContent = `${selectedSecData.count}개 사업 (신규 ${selectedSecData.newCount}개)`;

    // Render Sector Projects Chart
    createOrUpdateChart('chart-sector-projects', {
      type: 'bar',
      data: {
        labels: selectedSecData.projects.map(p => p.name.length > 18 ? p.name.slice(0, 17) + '…' : p.name),
        datasets: [
          {
            label: '2026년 예산',
            data: selectedSecData.projects.map(p => p.prev),
            backgroundColor: '#cbd5e1',
            borderRadius: 4
          },
          {
            label: '2027년 정부안',
            data: selectedSecData.projects.map(p => p.curr),
            backgroundColor: '#1d4ed8',
            borderRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { font: { size: 11, family: 'Pretendard, sans-serif' } } },
          y: { ticks: { callback: v => `${utils.formatNumber(v)} 억` } }
        },
        plugins: {
          legend: { position: 'top' },
          tooltip: {
            callbacks: {
              title: ctx => selectedSecData.projects[ctx[0].dataIndex].name,
              label: ctx => ` ${ctx.dataset.label}: ${utils.formatCurrency(ctx.raw)}`
            }
          }
        }
      }
    });

    // Render Sector Project Cards
    const cardsContainer = document.getElementById('sector-projects-cards');
    if (cardsContainer) {
      cardsContainer.innerHTML = selectedSecData.projects.map(p => `
        <div class="project-card ${p.isNew ? 'is-new-card' : ''}">
          <div class="project-card-header">
            <div>
              <span class="project-sector-tag">${p.sector}</span>
              <h4 class="project-card-title">${p.name}</h4>
            </div>
            ${p.isNew ? '<span class="badge-tag badge-new">신규사업</span>' : utils.formatRate(p.rateText, p.rateVal)}
          </div>
          <div class="project-budget-row">
            <div class="budget-val-block">
              <div class="budget-val-label">2027년 정부안</div>
              <div class="budget-val-amount">${utils.formatNumber(p.curr)} <span style="font-size:0.85rem; font-weight:normal;">억원</span></div>
            </div>
            <div class="budget-val-block text-right">
              <div class="budget-val-label">전년 대비 증감</div>
              <div class="budget-val-diff" style="color:${p.diff >= 0 ? '#059669' : '#dc2626'}">
                ${p.diff >= 0 ? '+' : ''}${utils.formatNumber(p.diff)} 억원 (${p.rateText})
              </div>
            </div>
          </div>
          <div class="project-desc-box">
            ${p.desc || '세부 사업 설명 없음'}
          </div>
        </div>
      `).join('');
    }
  }

  // View 3: New Projects Focused Hub
  function renderNewProjectsView() {
    const newProjects = state.data.filter(p => p.isNew);
    const totalNewSum = newProjects.reduce((acc, cur) => acc + cur.curr, 0);
    const avgNewSum = newProjects.length > 0 ? (totalNewSum / newProjects.length).toFixed(1) : 0;
    const maxProject = newProjects.length > 0 ? [...newProjects].sort((a, b) => b.curr - a.curr)[0] : null;

    document.getElementById('new-kpi-count').textContent = newProjects.length;
    document.getElementById('new-kpi-sum').textContent = utils.formatNumber(totalNewSum);
    document.getElementById('new-kpi-avg').textContent = utils.formatNumber(avgNewSum);
    document.getElementById('new-kpi-max').textContent = maxProject ? `${maxProject.name} (${utils.formatNumber(maxProject.curr)}억)` : '-';

    // Sorted Ranking Bar Chart
    const sortedNew = [...newProjects].sort((a, b) => b.curr - a.curr);

    createOrUpdateChart('chart-new-ranking', {
      type: 'bar',
      data: {
        labels: sortedNew.map(p => p.name),
        datasets: [{
          label: '2027년 정부안 예산 (억원)',
          data: sortedNew.map(p => p.curr),
          backgroundColor: '#059669',
          borderRadius: 6
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            ticks: { callback: v => `${utils.formatNumber(v)} 억` },
            grid: { color: '#f1f5f9' }
          },
          y: {
            ticks: { font: { size: 12, family: 'Pretendard, sans-serif' } },
            grid: { display: false }
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => ` 편성 예산: ${utils.formatCurrency(ctx.raw)}`
            }
          }
        }
      }
    });

    // New Projects Sector Distribution Pie Chart
    const newSectorMap = {};
    newProjects.forEach(p => {
      newSectorMap[p.sector] = (newSectorMap[p.sector] || 0) + p.curr;
    });

    const newSectorLabels = Object.keys(newSectorMap);
    const newSectorData = Object.values(newSectorMap);

    createOrUpdateChart('chart-new-sector-dist', {
      type: 'pie',
      data: {
        labels: newSectorLabels,
        datasets: [{
          data: newSectorData,
          backgroundColor: ['#6d28d9', '#d97706', '#10b981', '#64748b', '#2563eb', '#0284c7']
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { font: { size: 11, family: 'Pretendard, sans-serif' }, boxWidth: 12 }
          },
          tooltip: {
            callbacks: {
              label: ctx => {
                const pct = ((ctx.raw / totalNewSum) * 100).toFixed(1);
                return ` ${ctx.label}: ${utils.formatNumber(ctx.raw)} 억원 (${pct}%)`;
              }
            }
          }
        }
      }
    });

    // Render New Project Highlight Cards
    const cardsBox = document.getElementById('new-projects-cards-grid');
    if (cardsBox) {
      cardsBox.innerHTML = sortedNew.map((p, idx) => `
        <div class="project-card is-new-card">
          <div class="project-card-header">
            <div>
              <span class="project-sector-tag">${p.sector}</span>
              <h4 class="project-card-title">${idx + 1}. ${p.name}</h4>
            </div>
            <span class="badge-tag badge-new" style="font-size:0.8rem; padding: 0.25rem 0.6rem;">✨ 신규</span>
          </div>
          <div class="project-budget-row" style="background:#ecfdf5; border:1px solid #a7f3d0;">
            <div class="budget-val-block">
              <div class="budget-val-label" style="color:#047857;">2027년 신규 편성액</div>
              <div class="budget-val-amount" style="color:#065f46;">${utils.formatNumber(p.curr)} <span style="font-size:0.85rem; font-weight:normal;">억원</span></div>
            </div>
            <div class="budget-val-block text-right">
              <div class="budget-val-label" style="color:#047857;">전년도 예산</div>
              <div class="budget-val-diff" style="color:#065f46;">0 억원 (신규 편입)</div>
            </div>
          </div>
          <div class="project-desc-box" style="border-left-color:#10b981;">
            <strong style="color:#047857; display:block; margin-bottom:0.25rem;">📌 보도자료 및 정책 원문 근거</strong>
            ${p.desc || '설명 내용 없음'}
          </div>
        </div>
      `).join('');
    }
  }

  // View 4: Data Explorer Table
  function renderTable() {
    // Populate Sector Filter Options if not already done
    const sectorFilterSelect = document.getElementById('table-sector-select');
    if (sectorFilterSelect && sectorFilterSelect.options.length <= 1) {
      const stats = computeStats(state.data);
      stats.sectorsList.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.name;
        opt.textContent = s.name;
        sectorFilterSelect.appendChild(opt);
      });
    }

    // Filter data
    let filtered = state.data.filter(item => {
      // Search keyword filter
      if (state.tableSearch) {
        const target = `${item.name} ${item.sector} ${item.desc} ${item.no}`.toLowerCase();
        if (!target.includes(state.tableSearch)) return false;
      }
      // Sector filter
      if (state.tableSectorFilter !== '전체' && item.sector !== state.tableSectorFilter) {
        return false;
      }
      // Only new filter
      if (state.tableOnlyNew && !item.isNew) {
        return false;
      }
      return true;
    });

    // Sort data
    filtered.sort((a, b) => {
      let va = a[state.sortField];
      let vb = b[state.sortField];

      if (state.sortField === 'rate') {
        va = a.isNew ? 999999 : (a.rateVal || 0);
        vb = b.isNew ? 999999 : (b.rateVal || 0);
      }

      if (typeof va === 'string') {
        return state.sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
      }
      return state.sortAsc ? (va - vb) : (vb - va);
    });

    // Update Sort Indicators
    document.querySelectorAll('th[data-sort]').forEach(th => {
      const field = th.dataset.sort;
      th.classList.toggle('sorted-asc', state.sortField === field && state.sortAsc);
      th.classList.toggle('sorted-desc', state.sortField === field && !state.sortAsc);
      const icon = state.sortField === field ? (state.sortAsc ? ' ↑' : ' ↓') : '';
      th.textContent = th.textContent.replace(/[↑↓]/g, '').trim() + icon;
    });

    // Render Rows
    const tbody = document.getElementById('table-tbody');
    if (tbody) {
      if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="text-center" style="padding: 2.5rem; color:#94a3b8;">조건에 일치하는 사업이 없습니다.</td></tr>`;
      } else {
        tbody.innerHTML = filtered.map(item => `
          <tr class="${item.isNew ? 'is-new-row' : ''}">
            <td class="text-center">${item.no}</td>
            <td><span class="project-sector-tag" style="margin:0;">${item.sector}</span></td>
            <td><strong>${item.name}</strong></td>
            <td class="text-center">${item.unit}</td>
            <td class="text-right">${utils.formatNumber(item.prev)}</td>
            <td class="text-right" style="font-weight:700;">${utils.formatNumber(item.curr)}</td>
            <td class="text-right" style="font-weight:700; color:${item.diff >= 0 ? '#059669' : '#dc2626'}">
              ${item.diff >= 0 ? '+' : ''}${utils.formatNumber(item.diff)}
            </td>
            <td class="text-center">${utils.formatRate(item.rateText, item.rateVal)}</td>
            <td style="max-width: 380px; font-size: 0.8rem; color:#475569;">${item.desc || '-'}</td>
          </tr>
        `).join('');
      }
    }

    // Update Footer Totals
    const sumPrev = filtered.reduce((acc, c) => acc + c.prev, 0);
    const sumCurr = filtered.reduce((acc, c) => acc + c.curr, 0);
    const sumDiff = filtered.reduce((acc, c) => acc + c.diff, 0);
    const avgRate = sumPrev > 0 ? ((sumDiff / sumPrev) * 100).toFixed(1) : '-';

    document.getElementById('table-count-label').textContent = `조회 결과: 총 ${filtered.length}건`;
    document.getElementById('table-sum-prev').textContent = utils.formatNumber(sumPrev);
    document.getElementById('table-sum-curr').textContent = utils.formatNumber(sumCurr);
    document.getElementById('table-sum-diff').textContent = (sumDiff >= 0 ? '+' : '') + utils.formatNumber(sumDiff);
    document.getElementById('table-avg-rate').textContent = avgRate !== '-' ? `+${avgRate}%` : '-';
  }

  // Export to Excel
  function exportToExcel() {
    try {
      const exportRows = state.data.map(item => ({
        '연번': item.no,
        '분야 (중점영역)': item.sector,
        '세부 사업 / 주요 지표': item.name,
        '구분/단위': item.unit,
        '2026년 (A)': item.prev,
        '2027년 정부안 (B)': item.curr,
        '증감 (B-A)': item.diff,
        '증가율 (%)': item.rateText,
        '핵심 내용 및 보도자료 박스 원문 근거': item.desc
      }));

      const ws = XLSX.utils.json_to_sheet(exportRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '중점사업_분석결과');
      XLSX.writeFile(wb, `국방예산_대시보드_데이터_${new Date().toISOString().slice(0, 10)}.xlsx`);
      utils.showToast('엑셀 파일이 성공적으로 다운로드되었습니다.', 'success');
    } catch (err) {
      console.error(err);
      utils.showToast('엑셀 내보내기 실패: ' + err.message, 'error');
    }
  }

  // Export to CSV
  function exportToCsv() {
    try {
      const headers = ['연번', '분야 (중점영역)', '세부 사업 / 주요 지표', '구분/단위', '2026년 (A)', '2027년 정부안 (B)', '증감 (B-A)', '증가율 (%)', '핵심 내용 및 보도자료 박스 원문 근거'];
      const rows = state.data.map(item => [
        item.no,
        `"${item.sector.replace(/"/g, '""')}"`,
        `"${item.name.replace(/"/g, '""')}"`,
        item.unit,
        item.prev,
        item.curr,
        item.diff,
        `"${item.rateText}"`,
        `"${item.desc.replace(/"/g, '""')}"`
      ]);

      const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `국방예산_데이터_${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      utils.showToast('CSV 파일이 다운로드되었습니다.', 'success');
    } catch (err) {
      console.error(err);
      utils.showToast('CSV 내보내기 실패: ' + err.message, 'error');
    }
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }

})();
