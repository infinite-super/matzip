/* 나의 맛집 지도 v2 — 휴대폰 화면 */
(function () {
  'use strict';
  const CFG = window.APP_CONFIG || {};
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 불가 시 무시 */ } }
  };

  const PREF = {
    '검증완료': { color: '#2f9e44', cls: 'b-g' }, '우선방문': { color: '#7048e8', cls: 'b-p' },
    '저장만': { color: '#f76707', cls: 'b-o' }, '제주현지추천': { color: '#1098ad', cls: 'b-j' }
  };
  const PREF_ORDER = { '검증완료': 0, '제주현지추천': 1, '우선방문': 2, '저장만': 3 };
  const PAGE = 80;

  const S = {
    key: '', role: '', name: '', categories: [], prefs: Object.keys(PREF),
    places: [], byId: {}, filtered: [], shown: PAGE, view: 'map', pos: null, menus: [],
    f: { q: '', cats: [], prefs: [], sido: '', sgg: '', quick: [], sort: 'auto', inView: false },
    friendMode: { searching: false, more: false },
    visit: null
  };
  let map = null, clusterer = null, meMarker = null, markerImgs = {}, friendMarkers = [], visitMarker = null, visitCircle = null;

  // ---------- 키 확인 ----------
  const urlKey = new URLSearchParams(location.search).get('k');
  if (urlKey) { S.key = urlKey.replace(/[^A-Za-z0-9]/g, ''); store.set('mz_key', S.key); }
  else S.key = store.get('mz_key', '');
  if (!S.key) return gate('초대받은 링크로 접속해 주세요', '이 지도는 초대받은 분만 볼 수 있습니다.');
  if (!CFG.API_URL || /여기에/.test(CFG.API_URL)) return gate('설정 필요', 'config.js에 Apps Script 웹앱 주소를 입력하세요.');

  function gate(title, msg) {
    const g = $('gate'); g.hidden = false;
    g.innerHTML = `<h2>${esc(title)}</h2><div>${esc(msg)}</div>`;
  }

  // ---------- 서버 요청 ----------
  // 서버 통신: 스크립트 태그(GET) 방식 — 브라우저 교차 출처(CORS) 제한을 받지 않음
  let apiSeq = 0;
  function api(action, data) {
    return new Promise((resolve, reject) => {
      const cb = '__mz' + Date.now().toString(36) + (apiSeq++);
      const p = JSON.stringify(Object.assign({ k: S.key, action }, data || {}));
      const url = CFG.API_URL + '?cb=' + cb + '&p=' + encodeURIComponent(p);
      if (url.length > 7800) return reject(new Error('입력 내용이 너무 깁니다. 메모·한줄평을 줄여 주세요.'));
      const s = document.createElement('script');
      let done = false;
      const timer = setTimeout(() => finish(new Error('서버 응답이 없습니다. 잠시 후 다시 시도해 주세요.')), 60000);
      function finish(err, j) {
        if (done) return; done = true;
        clearTimeout(timer);
        try { delete window[cb]; } catch (e) { window[cb] = undefined; }
        s.remove();
        if (err) reject(err);
        else if (!j || !j.ok) reject(new Error((j && j.error) || '서버 오류'));
        else resolve(j);
      }
      window[cb] = j => finish(null, j);
      s.onerror = () => finish(new Error('서버에 연결하지 못했습니다 (Apps Script 배포 설정 확인)'));
      s.src = url;
      document.head.appendChild(s);
    });
  }

  let toastT;
  function toast(msg, ms) {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms || 2200);
  }
  function banner(msg) { const b = $('banner'); b.hidden = !msg; b.textContent = msg || ''; }

  // ---------- 카카오 지도 로드 ----------
  function loadKakao() {
    return new Promise((res, rej) => {
      if (window.kakao && window.kakao.maps && window.kakao.maps.Map) return res();
      const s = document.createElement('script');
      s.src = 'https://dapi.kakao.com/v2/maps/sdk.js?autoload=false&libraries=clusterer&appkey=' + encodeURIComponent(CFG.KAKAO_JS_KEY);
      s.onload = () => { try { kakao.maps.load(res); } catch (e) { rej(e); } };
      s.onerror = () => rej(new Error('카카오 지도를 불러오지 못했습니다'));
      document.head.appendChild(s);
    });
  }

  function pinImg(color) {
    if (markerImgs[color]) return markerImgs[color];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26"><circle cx="13" cy="13" r="10" fill="${color}" stroke="#fff" stroke-width="3"/></svg>`;
    const src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    markerImgs[color] = new kakao.maps.MarkerImage(src, new kakao.maps.Size(26, 26), { offset: new kakao.maps.Point(13, 13) });
    return markerImgs[color];
  }
  const colorOf = p => (S.role === 'owner' ? (PREF[p.pf] || PREF['저장만']).color : (p.ver ? PREF['검증완료'].color : PREF['저장만'].color));

  function initMap() {
    const saved = store.get('mz_map_' + S.role, null);
    const c = saved ? saved.c : (CFG.DEFAULT_CENTER || [37.5665, 126.978]);
    map = new kakao.maps.Map($('map'), { center: new kakao.maps.LatLng(c[0], c[1]), level: saved ? saved.l : 7 });
    if (S.role === 'owner') {
      clusterer = new kakao.maps.MarkerClusterer({ map, averageCenter: true, minLevel: 8, gridSize: 50, minClusterSize: 3,
        styles: [{ width: '40px', height: '40px', background: 'rgba(28,126,214,.85)', borderRadius: '20px', color: '#fff', textAlign: 'center', lineHeight: '40px', fontWeight: '700', fontSize: '13px' }] });
    }
    let idleT;
    kakao.maps.event.addListener(map, 'idle', () => {
      const ce = map.getCenter();
      store.set('mz_map_' + S.role, { c: [ce.getLat(), ce.getLng()], l: map.getLevel() });
      clearTimeout(idleT);
      idleT = setTimeout(() => {
        if (S.role === 'friend') { if (!S.friendMode.searching) friendArea(); }
        else if (S.f.inView && S.view === 'list') applyFilters(true);
      }, 350);
    });
  }

  // ---------- 시작 ----------
  restoreUI();
  start();

  async function start() {
    try {
      const cached = store.get('mz_owner_cache', null);
      const kakaoP = loadKakao();
      let initP = api('init');
      let data;
      if (cached && cached.key === S.key) {   // 본인: 이전 데이터로 먼저 표시 후 새로 고침
        data = { role: 'owner', categories: cached.categories, prefs: cached.prefs, places: cached.places, pending: 0 };
      } else {
        data = await initP; initP = null;
      }
      await kakaoP.catch(e => { throw new Error(e.message + '\n(카카오 JavaScript 키와 사이트 도메인 등록을 확인하세요)'); });
      boot(data);
      if (initP) {
        initP.then(fresh => { if (fresh.role === 'owner') { setOwnerData(fresh); applyFilters(); } })
          .catch(e => { if (/초대/.test(e.message)) { store.set('mz_owner_cache', null); gate('접속 권한 없음', e.message); } });
      }
    } catch (e) {
      if (/초대/.test(e.message)) { store.set('mz_owner_cache', null); gate('접속 권한 없음', e.message); }
      else gate('불러오기 실패', e.message);
    }
  }

  function boot(data) {
    S.role = data.role; S.name = data.name || '';
    S.categories = data.categories || [];
    document.body.classList.toggle('owner', S.role === 'owner');
    $('addLabel').textContent = S.role === 'owner' ? '추가' : '건의';
    initMap();
    buildChips();
    bindUI();
    if (S.role === 'owner') { setOwnerData(data); applyFilters(); }
    else { toast(`${S.name}님, 환영합니다`); friendArea(); }
    setView(S.view);
    locate(true, true);   // 시작하면 내 위치 주변으로
  }

  function setOwnerData(d) {
    S.places = d.places || [];
    S.byId = {};
    const menus = new Set();
    S.places.forEach(p => {
      S.byId[p.id] = p;
      [p.v1, p.v2].concat(String(p.m || '').split(',')).forEach(x => { x = String(x || '').trim(); if (x) menus.add(x); });
      p._hay = [p.n, p.sd, p.sg, p.dg, p.a, p.c, p.m, p.v1, p.v2, p.t, p.memo, p.pc, p.kc, p.f, p.pf].join(' ').toLowerCase();
    });
    S.menus = Array.from(menus).sort();
    if (d.prefs) S.prefs = d.prefs;
    fillRegions();
    setInbox(d.pending || 0);
    if (clusterer) { clusterer.clear(); S.places.forEach(p => { p._mk = null; }); }
    store.set('mz_owner_cache', { key: S.key, categories: S.categories, prefs: S.prefs, places: S.places.map(stripPriv) });
  }
  const stripPriv = p => { const q = Object.assign({}, p); delete q._mk; delete q._hay; delete q._d; return q; };

  function setInbox(n) { const b = $('inboxBadge'); b.hidden = !n; b.textContent = n; }

  // ---------- 필터 UI ----------
  // 상단 원탭 칩 (하나만 선택, 다시 누르면 해제) — 나머지 분류는 ⚙ 필터에서
  const QUICK_OWNER = [{ id: 'all', label: '전체' }, { id: 'pri', label: '우선방문' }, { id: 'ver', label: '검증완료' }];
  const QUICK_FRIEND = [{ id: 'all', label: '전체' }, { id: 'ver', label: '✔ 검증된 곳' }];
  const QUICK_CATS = ['한식', '중식', '일식', '분식'];
  const QUICK_LABEL = { pri: '우선방문', ver: '검증완료' };
  const EDIT_PREFS = () => S.prefs.filter(x => x !== '제주현지추천');   // 메뉴에서 제외 (기존 표시는 유지)
  const origin = () => (S.visit ? [S.visit.la, S.visit.lo] : S.pos);

  function activeQuick() {
    if (S.f.quick.length === 1 && !S.f.cats.length && !S.f.prefs.length) return 'q:' + S.f.quick[0];
    if (S.f.cats.length === 1 && !S.f.quick.length && !S.f.prefs.length) return 'c:' + S.f.cats[0];
    return '';
  }
  function filterLabel() {
    const parts = S.f.quick.map(x => QUICK_LABEL[x] || x).concat(S.f.cats, S.f.prefs, S.f.sgg || S.f.sido || [], S.f.q ? ['"' + S.f.q + '"'] : []);
    const base = parts.length ? parts.join(' · ') : '전체';
    return S.visit ? `📍${S.visit.name} · ${base}` : base;
  }

  function buildChips() {
    const quick = S.role === 'owner' ? QUICK_OWNER : QUICK_FRIEND;
    const act = activeQuick();
    const none = !S.f.quick.length && !S.f.cats.length && !S.f.prefs.length && !S.f.q && !S.f.sido && !S.f.sgg;
    $('quick').innerHTML = quick.map(c => `<button class="chip${(c.id === 'all' ? none : act === 'q:' + c.id) ? ' on' : ''}" data-q="${c.id}">${c.label}</button>`).join('') +
      QUICK_CATS.map(c => `<button class="chip${act === 'c:' + c ? ' on' : ''}" data-c="${esc(c)}">${esc(c)}</button>`).join('');
    $('catChips').innerHTML = S.categories.map(c => `<button class="chip${S.f.cats.indexOf(c) >= 0 ? ' on' : ''}" data-c="${esc(c)}">${esc(c)}</button>`).join('');
    $('prefChips').innerHTML = EDIT_PREFS().map(p => `<button class="chip${S.f.prefs.indexOf(p) >= 0 ? ' on' : ''}" data-p="${esc(p)}">${esc(p)}</button>`).join('');
  }

  function toggleArr(arr, v) { const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v); }

  function fillRegions() {
    const sidos = Array.from(new Set(S.places.map(p => p.sd).filter(Boolean))).sort();
    $('sido').innerHTML = '<option value="">전체 시도</option>' + sidos.map(s => `<option${s === S.f.sido ? ' selected' : ''}>${esc(s)}</option>`).join('');
    fillSgg();
  }
  function fillSgg() {
    const sgg = Array.from(new Set(S.places.filter(p => !S.f.sido || p.sd === S.f.sido).map(p => p.sg).filter(Boolean))).sort();
    $('sgg').innerHTML = '<option value="">전체 시군구</option>' + sgg.map(s => `<option${s === S.f.sgg ? ' selected' : ''}>${esc(s)}</option>`).join('');
  }

  function restoreUI() {
    const f = store.get('mz_filters', null);
    if (f) Object.assign(S.f, f, { q: '' });
    S.f.quick = (S.f.quick || []).filter(x => QUICK_LABEL[x]);
    S.f.cats = S.f.cats || []; S.f.prefs = S.f.prefs || [];
    if (S.f.quick.length + S.f.cats.length + S.f.prefs.length > 1) { S.f.quick = []; S.f.cats = []; S.f.prefs = []; }
    S.view = store.get('mz_view', 'map');
    $('sort').value = S.f.sort || 'auto';
    $('inView').checked = !!S.f.inView;
  }
  function saveUI() { store.set('mz_filters', Object.assign({}, S.f, { q: '' })); store.set('mz_view', S.view); }

  let bound = false;
  function bindUI() {
    if (bound) return; bound = true;
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-q],[data-c],[data-p]');
      if (!b || !b.closest('#top')) return;
      if (b.closest('#quick')) {
        // 원탭 칩: 하나만 선택 (같은 칩 다시 누르면 전체 보기)
        const qid = b.dataset.q;
        if (qid === 'visitClear') { clearVisit(); return; }
        if (qid === 'all') {   // 전체: 분류·검색어·지역 해제 (선택한 방문지는 유지)
          S.f.quick = []; S.f.cats = []; S.f.prefs = []; S.f.sido = ''; S.f.sgg = ''; S.f.q = ''; $('q').value = '';
          S.friendMode.searching = false;
          if (S.role === 'owner') fillRegions();
        } else {
          const key = qid ? 'q:' + qid : 'c:' + b.dataset.c;
          const same = activeQuick() === key;
          S.f.quick = []; S.f.cats = []; S.f.prefs = [];
          if (!same) { if (qid) S.f.quick = [qid]; else S.f.cats = [b.dataset.c]; }
        }
      } else if (b.dataset.c) toggleArr(S.f.cats, b.dataset.c);
      else if (b.dataset.p) toggleArr(S.f.prefs, b.dataset.p);
      buildChips(); saveUI(); refresh();
      if (S.role === 'owner') showResultsOnMap();
    });
    $('q').addEventListener('input', () => {   // 입력 중에는 아무것도 바꾸지 않음. 지우면 검색 해제
      if (!$('q').value.trim() && S.f.q) { S.f.q = ''; S.friendMode.searching = false; buildChips(); refresh(); }
    });
    $('q').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); openSearch(); } });
    $('btnSearch').onclick = openSearch;
    $('btnMode').onclick = () => { setMode(S.mode === 'place' ? 'food' : 'place'); $('q').focus(); };
    setMode(store.get('mz_mode', 'place'));
    document.addEventListener('click', e => { if (!$('filterPanel').hidden && !e.target.closest('#top')) closeFilter(); }, true);   // 필터창 밖을 누르면 닫힘
    $('fpClose').onclick = closeFilter;
    $('btnFilter').onclick = () => { const fp = $('filterPanel'); fp.hidden = !fp.hidden; $('btnFilter').classList.toggle('on', !fp.hidden); };
    $('sido').onchange = () => { S.f.sido = $('sido').value; S.f.sgg = ''; fillSgg(); saveUI(); applyFilters(); fitFiltered(); };
    $('sgg').onchange = () => { S.f.sgg = $('sgg').value; saveUI(); applyFilters(); fitFiltered(); };
    $('sort').onchange = () => { S.f.sort = $('sort').value; if (S.f.sort === 'dist' && !S.pos) locate(false); saveUI(); refresh(); };
    $('inView').onchange = () => { S.f.inView = $('inView').checked; saveUI(); applyFilters(true); };
    $('btnReset').onclick = () => { S.f = { q: '', cats: [], prefs: [], sido: '', sgg: '', quick: [], sort: 'auto', inView: false }; $('q').value = ''; $('sort').value = 'auto'; $('inView').checked = false; buildChips(); fillRegions(); saveUI(); refresh(); };
    document.querySelectorAll('#bottom [data-view]').forEach(b => { b.onclick = () => setView(b.dataset.view); });
    $('btnLocate').onclick = () => locate(true);
    $('btnAdd').onclick = openAdd;
    $('btnInbox').onclick = openInbox;
    $('more').onclick = () => { S.shown += PAGE; renderList(); };
    $('sheetBack').onclick = closeSheet;
    $('sheetX').onclick = closeSheet;
    window.addEventListener('popstate', () => { if (!$('sheet').hidden) hideSheet(); });
  }

  // 현재 지도 화면에 결과가 하나도 없으면 결과가 있는 곳으로 지도를 옮김
  function showResultsOnMap() {
    if (!map || !S.filtered.length || S.view !== 'map') return;
    const b = map.getBounds();
    const any = S.filtered.some(p => b.contain(new kakao.maps.LatLng(p.la, p.lo)));
    if (!any) fitFiltered();
  }
  function setMapCount(n) {
    const el = $('mapCount');
    el.textContent = `${filterLabel()} · ${n.toLocaleString()}곳`;
  }

  function refresh() { if (S.role === 'owner') applyFilters(); else if (S.friendMode.searching) friendSearch(); else friendArea(); }

  function setView(v) {
    S.view = v; saveUI();
    $('listView').hidden = v !== 'list';
    document.querySelectorAll('#bottom [data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === v));
    if (v === 'map' && map) setTimeout(() => map.relayout(), 0);
    if (v === 'list') { if (S.role === 'owner' && S.f.inView) applyFilters(true); else renderList(); }
  }

  // ---------- 위치 ----------
  function locate(moveMap, initial) {
    if (!navigator.geolocation) { if (!initial) toast('이 기기에서는 위치 기능을 쓸 수 없습니다'); return; }
    if (!initial) toast('현재 위치 확인 중…');
    navigator.geolocation.getCurrentPosition(pos => {
      S.pos = [pos.coords.latitude, pos.coords.longitude];
      const ll = new kakao.maps.LatLng(S.pos[0], S.pos[1]);
      if (!meMarker) {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22"><circle cx="11" cy="11" r="7" fill="#1c7ed6" stroke="#fff" stroke-width="4"/></svg>';
        meMarker = new kakao.maps.Marker({ position: ll, zIndex: 10,
          image: new kakao.maps.MarkerImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg), new kakao.maps.Size(22, 22), { offset: new kakao.maps.Point(11, 11) }) });
        meMarker.setMap(map);
      } else meMarker.setPosition(ll);
      if (moveMap && S.visit && !initial) clearVisit(true);   // 내 위치 버튼 = 방문지 해제
      if (moveMap && !S.visit) { map.setLevel(5); map.setCenter(ll); }
      if (S.f.sort === 'auto' || S.f.sort === 'dist') refresh();
    }, () => toast(initial ? '위치 권한을 허용하면 내 주변부터 보여줍니다' : '위치 권한을 허용해 주세요', 3000), { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  }

  function dist(a, b) {
    const R = 6371000, r = x => x * Math.PI / 180;
    const dLa = r(b[0] - a[0]), dLo = r(b[1] - a[1]);
    const h = Math.sin(dLa / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dLo / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const fmtDist = m => (m < 1000 ? Math.round(m) + 'm' : (m / 1000).toFixed(1) + 'km');

  // ---------- 본인: 필터 ----------
  function applyFilters(listOnly) {
    if (S.role !== 'owner') return;
    const f = S.f;
    const toks = f.q.toLowerCase().split(/\s+/).filter(Boolean);
    const q = f.quick;
    let b = null;
    if (f.inView && map) b = map.getBounds();
    const org = origin();
    const arr = S.places.filter(p => {
      p._d = org ? dist(org, [p.la, p.lo]) : null;
      if (f.cats.length && f.cats.indexOf(p.c) < 0) return false;
      if (f.prefs.length && f.prefs.indexOf(p.pf) < 0) return false;
      if (f.sido && p.sd !== f.sido) return false;
      if (f.sgg && p.sg !== f.sgg) return false;
      if (q.indexOf('work') >= 0 && p.t.indexOf('직장주변') < 0) return false;
      if (q.indexOf('pri') >= 0 && p.pf !== '우선방문') return false;
      if (q.indexOf('ver') >= 0 && p.pf !== '검증완료') return false;
      if (q.indexOf('unv') >= 0 && p.v) return false;
      if (q.indexOf('vm') >= 0 && !(p.v1 || p.v2)) return false;
      if (q.indexOf('fr') >= 0 && !(p.ra >= 4)) return false;
      if (q.indexOf('bw') >= 0 && p.t.indexOf('흑백요리사') < 0) return false;
      if (q.indexOf('jj') >= 0 && p.pf !== '제주현지추천') return false;
      if (toks.length && !toks.every(t => p._hay.indexOf(t) >= 0)) return false;
      if (b && !b.contain(new kakao.maps.LatLng(p.la, p.lo))) return false;
      return true;
    });
    const vmHit = p => (toks.length && toks.some(t => (p.v1 + ' ' + p.v2).toLowerCase().indexOf(t) >= 0) ? 1 : 0);
    const prefSort = (a, b2) => (PREF_ORDER[a.pf] - PREF_ORDER[b2.pf]) || ((b2.r || 0) - (a.r || 0)) || ((b2.ra || 0) - (a.ra || 0));
    const sorts = {
      dist: (a, b2) => (a._d || 0) - (b2._d || 0),
      mine: (a, b2) => ((b2.r || 0) - (a.r || 0)) || prefSort(a, b2),
      friends: (a, b2) => ((b2.ra || 0) - (a.ra || 0)) || ((b2.rn || 0) - (a.rn || 0)),
      recent: (a, b2) => String(b2.dt).localeCompare(String(a.dt)),
      auto: (a, b2) => (vmHit(b2) - vmHit(a)) || (org ? (a._d - b2._d) : prefSort(a, b2))
    };
    arr.sort(sorts[f.sort] && (f.sort !== 'dist' || org) ? sorts[f.sort] : sorts.auto);
    S.filtered = arr;
    S.shown = PAGE;
    $('count').textContent = `${arr.length.toLocaleString()}곳 / 전체 ${S.places.length.toLocaleString()}`;
    setMapCount(arr.length);
    if (!listOnly) renderMarkers();
    renderList();
  }

  function markerFor(p) {
    if (p._mk) return p._mk;
    const mk = new kakao.maps.Marker({ position: new kakao.maps.LatLng(p.la, p.lo), image: pinImg(colorOf(p)), title: p.n });
    kakao.maps.event.addListener(mk, 'click', () => openPlace(p));
    p._mk = mk;
    return mk;
  }

  function renderMarkers() {
    if (S.role === 'owner') {
      clusterer.clear();
      clusterer.addMarkers(S.filtered.map(markerFor));
    } else {
      friendMarkers.forEach(m => m.setMap(null));
      friendMarkers = S.filtered.map(p => { const m = markerFor(p); m.setMap(map); return m; });
    }
  }

  function fitFiltered() {
    if (!map || !S.filtered.length) return;
    const bd = new kakao.maps.LatLngBounds();
    S.filtered.slice(0, 2000).forEach(p => bd.extend(new kakao.maps.LatLng(p.la, p.lo)));
    map.setBounds(bd);
  }

  // ---------- 친구: 서버 조회 ----------
  function friendParams() {
    const q = S.f.quick;
    return { cats: S.f.cats, onlyVerified: q.indexOf('ver') >= 0, minRating: q.indexOf('fr') >= 0 ? 4 : 0, tag: q.indexOf('bw') >= 0 ? '흑백요리사' : '' };
  }
  let areaSeq = 0;
  async function friendArea() {
    if (!map) return;
    const b = map.getBounds(), sw = b.getSouthWest(), ne = b.getNorthEast();
    const seq = ++areaSeq;
    try {
      const r = await api('area', Object.assign({ sw: [sw.getLat(), sw.getLng()], ne: [ne.getLat(), ne.getLng()] }, friendParams()));
      if (seq !== areaSeq) return;
      setFriendResults(r.places, r.more ? '이 범위에 식당이 많습니다. 지도를 확대하면 더 보입니다.' : '');
    } catch (e) { toast(e.message, 3500); }
  }
  async function friendSearch() {
    if (!S.f.q) { S.friendMode.searching = false; return friendArea(); }
    S.friendMode.searching = true;
    try {
      const r = await api('search', Object.assign({ q: S.f.q }, friendParams()));
      setFriendResults(r.places, r.places.length ? (r.more ? '검색 결과가 많아 일부만 표시합니다. 검색어를 더 구체적으로 입력해 보세요.' : '') : '검색 결과가 없습니다.');
      if (r.places.length) { fitFiltered(); setView('list'); }
    } catch (e) { toast(e.message, 3500); }
  }
  function setFriendResults(list, msg) {
    friendMarkers.forEach(m => m.setMap(null));
    S.places = list; S.byId = {};
    list.forEach(p => { S.byId[p.id] = p; });
    const org = origin();
    if (org) list.forEach(p => { p._d = dist(org, [p.la, p.lo]); });
    const srt = { dist: (a, b) => (a._d || 0) - (b._d || 0), friends: (a, b) => ((b.ra || 0) - (a.ra || 0)) || ((b.rn || 0) - (a.rn || 0)) };
    if (srt[S.f.sort] && (S.f.sort !== 'dist' || org)) list.sort(srt[S.f.sort]);
    else if (S.visit) list.sort(srt.dist);
    S.filtered = list; S.shown = PAGE;
    $('count').textContent = `${list.length}곳`;
    setMapCount(list.length);
    banner(msg);
    renderMarkers(); renderList();
  }

  // ---------- 검색 종류: 📍 장소(지도 이동) / 🍽 식당(이름·메뉴로 찾기) ----------
  function setMode(m) {
    S.mode = m === 'food' ? 'food' : 'place';
    store.set('mz_mode', S.mode);
    const b = $('btnMode'), place = S.mode === 'place';
    b.textContent = place ? '📍 장소' : '🍽 식당';
    b.className = 'mode ' + S.mode;
    $('q').placeholder = place ? '가려는 곳 (예: 대전역)' : '식당 이름·메뉴 (예: 냉면)';
  }
  function closeFilter() { $('filterPanel').hidden = true; $('btnFilter').classList.remove('on'); }
  async function foodSearch(q) {
    S.f.q = q; S.f.quick = []; S.f.cats = []; S.f.prefs = [];
    buildChips();
    if (S.role === 'owner') {
      applyFilters();
      if (!S.filtered.length) { toast('일치하는 식당이 없습니다'); return; }
      setView('list');
    } else await friendSearch();
  }

  // ---------- 장소 검색(카카오) ----------
  async function openSearch() {
    const q = $('q').value.trim();
    $('q').blur(); closeFilter();
    if (!q) return;
    if (S.mode === 'food') return foodSearch(q);
    const owner = S.role === 'owner';
    let friendRes = null;
    openSheet(`<div class="sh-name">📍 “${esc(q)}” 어디로 갈까요?</div>
      <div id="srMineWrap" class="mine-box" hidden><div class="sec-t">🍽 ${owner ? '내 맛집' : '공개 맛집'}에 있어요</div><div id="srMine"></div></div>
      <div class="sec-t">📍 장소 — 고르면 그 주변 지도로 이동</div>
      <div id="srPlaces" class="sub">카카오에서 장소 찾는 중…</div>`);
    const showMine = list => {
      const el = $('srMine'); if (!el || !list.length) return;
      $('srMineWrap').hidden = false;
      const top = list.slice(0, 3);
      el.innerHTML = top.map((p, i) => `<div class="res place" data-m="${i}"><div class="grow"><div class="nm"><span class="dot" style="background:${colorOf(p)}"></span>${esc(p.n)}</div>
          <div class="sub">${esc([p.sd, p.sg].filter(Boolean).join(' '))}${p.c ? ' · ' + esc(p.c) : ''}</div></div><button class="btn small primary">이동</button></div>`).join('')
        + (list.length > 3 ? `<button class="btn small" id="srMineGo" style="width:100%;margin-top:6px">${owner ? '내 맛집' : '공개 맛집'} ${list.length}곳 목록 보기</button>` : '');
      el.onclick = e => {
        const row = e.target.closest('[data-m]'); if (!row) return;
        const p = top[+row.dataset.m];
        if (!owner) setFriendResults(friendRes.places, '');
        hideSheetThen(() => goPlace(p));
      };
      if (list.length > 3) $('srMineGo').onclick = () => {
        S.f.q = q; S.f.quick = []; S.f.cats = []; S.f.prefs = [];
        if (owner) { buildChips(); applyFilters(); }
        else { S.friendMode.searching = true; buildChips(); setFriendResults(friendRes.places, friendRes.more ? '검색 결과가 많아 일부만 표시합니다.' : ''); }
        hideSheetThen(() => setView('list'));
      };
    };
    if (owner) {
      const toks = q.toLowerCase().split(/\s+/).filter(Boolean);
      const hits = S.places.filter(p => toks.every(t => p._hay.indexOf(t) >= 0));
      const nm = q.replace(/\s+/g, '').toLowerCase();   // 이름이 일치하는 식당을 먼저
      hits.sort((a, b) => (b.n.replace(/\s+/g, '').toLowerCase().indexOf(nm) >= 0) - (a.n.replace(/\s+/g, '').toLowerCase().indexOf(nm) >= 0)
        || ((a._d == null ? 1e12 : a._d) - (b._d == null ? 1e12 : b._d)));   // 다음은 가까운 순
      showMine(hits);
    } else {
      api('search', Object.assign({ q }, friendParams())).then(res => { friendRes = res; showMine(res.places); })
        .catch(() => {});
    }
    try {
      const res = await api('kakaoSearch', { q });
      const el = $('srPlaces'); if (!el) return;
      const docs = res.docs.slice(0, 8);
      el.innerHTML = docs.length ? docs.map((d, i) => `<div class="res place" data-i="${i}"><div class="grow"><div class="nm">${esc(d.name)}</div>
          <div class="sub">${esc(d.addr)}${d.cat ? ' · ' + esc(String(d.cat).split(' > ').pop()) : ''}</div></div><button class="btn small primary">이동</button></div>`).join('')
        : '<div class="sub">카카오에서 찾은 장소가 없습니다. 지역명을 함께 입력해 보세요 (예: 경주 황리단길).</div>';
      el.onclick = e => {
        const row = e.target.closest('[data-i]'); if (!row) return;
        const d = docs[+row.dataset.i];
        hideSheetThen(() => setVisit({ name: d.name, la: d.y, lo: d.x }));
      };
    } catch (e) { const el = $('srPlaces'); if (el) el.textContent = e.message; }
  }
  const VISIT_LEVEL = 4;   // 장소 이동 시 지도 축척: 화면에 약 1km 범위, 식당 핀이 하나씩 보임
  function hideSheetThen(fn) { closeSheet(); setTimeout(fn, 50); }

  // 내 맛집 하나로 바로 이동: 지도 확대 + 정보창
  function goPlace(p) {
    if (S.role === 'owner' && S.filtered.indexOf(p) < 0) {   // 칩·필터에 가려지지 않게 해제
      Object.assign(S.f, { q: '', quick: [], cats: [], prefs: [], sido: '', sgg: '' }); $('q').value = '';
      buildChips(); fillRegions(); applyFilters();
    }
    setView('map');
    map.setLevel(3);
    map.setCenter(new kakao.maps.LatLng(p.la, p.lo));
    openPlace(p);
  }
  function setVisit(v) {
    S.visit = v; closeFilter();
    S.f.q = ''; $('q').value = ''; S.friendMode.searching = false;
    drawVisit(); buildChips();
    if (S.role === 'owner') applyFilters();   // 친구 화면은 지도 이동 후 자동 재조회
    toast(`${v.name} 주변 · 가까운 순`);
  }
  function clearVisit(silent) {
    S.visit = null; drawVisit(); buildChips();
    if (!silent) refresh();
  }
  function drawVisit() {
    if (visitMarker) { visitMarker.setMap(null); visitMarker = null; }
    if (visitCircle) { visitCircle.setMap(null); visitCircle = null; }
    if (!S.visit || !map) return;
    const v = S.visit, c = new kakao.maps.LatLng(v.la, v.lo);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="40"><path d="M15 1C7.3 1 1 7.1 1 14.7 1 25 15 39 15 39s14-14 14-24.3C29 7.1 22.7 1 15 1z" fill="#e03131" stroke="#fff" stroke-width="2"/><circle cx="15" cy="15" r="5" fill="#fff"/></svg>';
    visitMarker = new kakao.maps.Marker({ position: c, zIndex: 20, title: v.name,
      image: new kakao.maps.MarkerImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg), new kakao.maps.Size(30, 40), { offset: new kakao.maps.Point(15, 39) }) });
    visitMarker.setMap(map);
    map.setLevel(VISIT_LEVEL);
    map.setCenter(c);
  }

  // ---------- 목록 ----------
  function prefBadge(p) {
    if (S.role !== 'owner') return p.ver ? '<span class="badge b-g">✔ 검증</span>' : '';
    const pr = PREF[p.pf] || PREF['저장만'];
    return `<span class="badge ${pr.cls}">${esc(p.pf)}</span>` + (p.pub ? '<span class="badge b-pub">공개</span>' : '') + (p.ok === '검색안됨' ? '<span class="badge b-w">폐업?</span>' : '');
  }
  function stars(n) { n = Number(n) || 0; return n ? '★' + n : ''; }

  function renderList() {
    if (S.view !== 'list') return;
    const items = S.filtered.slice(0, S.shown).map((p, i) => {
      const vm = [p.v1, p.v2].filter(Boolean).join(' · ');
      const extra = [];
      if (S.role === 'owner' && p.r) extra.push('내 ★' + p.r);
      if (p.ra) extra.push(`지인 ★${p.ra} (${p.rn})`);
      if (p._d != null && origin()) extra.push(fmtDist(p._d));
      const note = S.role === 'owner' ? (p.memo || p.pc) : p.pc;
      return `<li data-i="${i}"><div class="nm"><span class="dot" style="background:${colorOf(p)}"></span>${esc(p.n)}${prefBadge(p)}</div>
        <div class="sub">${esc([p.sd, p.sg].filter(Boolean).join(' '))} · ${esc(p.c)}${p.m ? ' · ' + esc(p.m) : ''}${extra.length ? ' · ' + esc(extra.join(' · ')) : ''}</div>
        ${vm ? `<div class="vm">✔ ${esc(vm)}</div>` : ''}${note ? `<div class="note">${esc(note)}</div>` : ''}</li>`;
    });
    $('list').innerHTML = items.join('') || '<li class="sub">조건에 맞는 식당이 없습니다.</li>';
    $('list').querySelectorAll('li[data-i]').forEach(li => { li.onclick = () => openPlace(S.filtered[+li.dataset.i]); });
    $('more').hidden = S.filtered.length <= S.shown;
  }

  // ---------- 하단 정보창 ----------
  // 정보창: ✕ 버튼·바깥 누르기·휴대폰 뒤로가기로 닫힘
  function openSheet(html) {
    const wasHidden = $('sheet').hidden;
    $('sheetBody').innerHTML = html; $('sheet').hidden = false; $('sheetBack').hidden = false; $('sheet').scrollTop = 0;
    if (wasHidden) { try { history.pushState({ mzSheet: 1 }, ''); } catch (e) { /* 무시 */ } }
  }
  function hideSheet() { $('sheet').hidden = true; $('sheetBack').hidden = true; }
  function closeSheet() {
    if (history.state && history.state.mzSheet) history.back(); else hideSheet();
  }

  // 티맵 길안내: 출발지는 티맵이 현재 위치로 자동 설정. 안드로이드는 goal* 형식(시험 확인: 갤럭시 S25·티맵 11.8.4), 아이폰은 rGo* 형식
  const IS_IOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  function tmapUrl(p) { const n = encodeURIComponent(p.n);
    return IS_IOS ? `tmap://route?rGoName=${n}&rGoX=${p.lo}&rGoY=${p.la}` : `tmap://route?goalname=${n}&goalx=${p.lo}&goaly=${p.la}`; }
  function kakaoUrl(p) { return p.k ? `https://place.map.kakao.com/${encodeURIComponent(p.k)}` : `https://map.kakao.com/link/search/${encodeURIComponent(p.n)}`; }

  function openPlace(p) {
    if (!p) return;
    const vm = [p.v1, p.v2].filter(Boolean).join(' · ');
    let html = `<div class="sh-name">${esc(p.n)}</div>
      <div class="sub" style="margin-top:6px">${prefBadge(p)}</div>
      <div class="sub">${esc(p.c)}${p.m ? ' · ' + esc(p.m) : ''}${p.t ? ' · #' + esc(p.t.split(', ').join(' #')) : ''}</div>
      ${vm ? `<div class="vm" style="font-size:16px">✔ 검증 메뉴: ${esc(vm)}</div>` : ''}
      <div class="sub">${S.role === 'owner' && p.r ? '내 평점 ★' + p.r + ' · ' : ''}${p.ra ? `지인 평균 ★${p.ra} (${p.rn}명)` : '지인 평가 없음'}${p._d != null && origin() ? ' · ' + fmtDist(p._d) : ''}</div>
      ${p.pc ? `<div class="note">💬 ${esc(p.pc)}</div>` : ''}
      ${S.role === 'owner' && p.memo ? `<div class="note">📝 ${esc(p.memo)}</div>` : ''}
      <div class="sub">${esc(p.a)}</div>
      <div class="acts">
        <a class="btn primary" id="goTmap" href="${tmapUrl(p)}">🚗 티맵 길찾기</a>
        <a class="btn" href="${kakaoUrl(p)}" target="_blank" rel="noopener">ℹ️ 카카오맵 상세</a>
        <button class="btn" id="copyAddr">📋 주소 복사</button>
      </div>`;
    html += S.role === 'owner' ? ownerEditForm(p) : friendRateForm(p);
    html += `<div class="sec"><h4>지인 평가</h4><div id="rvList" class="sub">불러오는 중…</div></div>`;
    openSheet(html);
    $('copyAddr').onclick = () => { (navigator.clipboard ? navigator.clipboard.writeText(p.a) : Promise.reject()).then(() => toast('주소를 복사했습니다'), () => toast(p.a, 4000)); };
    $('goTmap').addEventListener('click', () => { setTimeout(() => { if (!document.hidden) toast('티맵이 열리지 않으면 앱 설치 여부를 확인하세요', 3500); }, 1800); });
    if (map && S.view === 'map') map.panTo(new kakao.maps.LatLng(p.la, p.lo));
    if (S.role === 'owner') bindOwnerEdit(p); else bindFriendRate(p);
    api('detail', { id: p.id }).then(r => {
      const el = $('rvList'); if (!el) return;
      el.innerHTML = r.ratings.length ? r.ratings.map(x => `<div class="rv"><b>${esc(x.who)}</b> ★${x.s}${x.mn ? ' · 추천: ' + esc(x.mn) : ''} <span class="sub">${esc(x.dt)}</span>${x.cm ? `<div>${esc(x.cm)}</div>` : ''}</div>`).join('') : '아직 지인 평가가 없습니다.';
    }).catch(() => { const el = $('rvList'); if (el) el.textContent = '평가를 불러오지 못했습니다.'; });
  }

  function starPicker(id, val) {
    return `<div class="stars" id="${id}">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-s="${n}" class="${n <= val ? 'on' : ''}">★</button>`).join('')}</div>`;
  }
  function bindStars(id, cb) {
    const el = $(id); let val = el.querySelectorAll('.on').length;
    el.onclick = e => {
      const b = e.target.closest('[data-s]'); if (!b) return;
      const n = +b.dataset.s; val = (val === n) ? 0 : n;
      el.querySelectorAll('[data-s]').forEach(x => x.classList.toggle('on', +x.dataset.s <= val));
      cb(val);
    };
  }

  function ownerEditForm(p) {
    const segs = EDIT_PREFS().map(x => `<button type="button" data-pf="${esc(x)}" class="${x === p.pf ? 'on' : ''}" style="${x === p.pf ? 'background:' + PREF[x].color : ''}">${esc(x)}</button>`).join('');
    return `<div class="sec"><h4>내 기록</h4>
      <div class="fld"><label>선호도</label><div class="seg" id="edPf">${segs}</div></div>
      <div class="fld"><label>내 평점 (같은 별을 다시 누르면 지움)</label>${starPicker('edR', p.r || 0)}</div>
      <div class="two">
        <div class="fld"><label>검증 메뉴 1</label><input type="text" id="edV1" list="menuList" value="${esc(p.v1)}" placeholder="예: 평양냉면"></div>
        <div class="fld"><label>검증 메뉴 2</label><input type="text" id="edV2" list="menuList" value="${esc(p.v2)}" placeholder="예: 수육"></div>
      </div>
      <datalist id="menuList">${S.menus.slice(0, 800).map(m => `<option value="${esc(m)}">`).join('')}</datalist>
      <div class="two">
        <label class="toggle"><input type="checkbox" id="edV" ${p.v ? 'checked' : ''}> 방문함</label>
        <label class="toggle"><input type="checkbox" id="edPub" ${p.pub ? 'checked' : ''}> 친구에게 공개</label>
      </div>
      <div class="fld"><label>공개 한줄평 (친구에게 보임)</label><input type="text" id="edPc" value="${esc(p.pc)}" maxlength="100"></div>
      <div class="fld"><label>개인 메모 (본인만)</label><textarea id="edMemo" maxlength="200">${esc(p.memo)}</textarea></div>
      <div class="fld"><label>대분류 ${p.kc ? '(카카오: ' + esc(p.kc) + ')' : ''}</label>
        <select id="edC">${S.categories.map(c => `<option${c === p.c ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
      <button class="btn primary" id="edSave" style="width:100%">저장</button>
      ${p.f ? `<div class="sub" style="margin-top:8px">카카오 폴더: ${esc(p.f)}</div>` : ''}</div>`;
  }

  function bindOwnerEdit(p) {
    const st = { pf: p.pf, r: p.r || '' };
    $('edPf').onclick = e => {
      const b = e.target.closest('[data-pf]'); if (!b) return;
      st.pf = b.dataset.pf;
      $('edPf').querySelectorAll('[data-pf]').forEach(x => { const on = x.dataset.pf === st.pf; x.classList.toggle('on', on); x.style.background = on ? PREF[x.dataset.pf].color : ''; });
      if (st.pf === '검증완료') $('edV').checked = true;
    };
    bindStars('edR', v => { st.r = v || ''; });
    const v1el = $('edV1'), v2el = $('edV2');
    const onMenu = () => { if ((v1el.value.trim() || v2el.value.trim()) && (st.pf === '저장만' || st.pf === '우선방문')) $('edPf').querySelector('[data-pf="검증완료"]').click(); };
    v1el.onchange = onMenu; v2el.onchange = onMenu;
    $('edSave').onclick = async () => {
      const fields = { pf: st.pf, r: st.r, v1: v1el.value.trim(), v2: v2el.value.trim(), v: $('edV').checked, pub: $('edPub').checked,
        pc: $('edPc').value.trim(), memo: $('edMemo').value.trim() };
      if ($('edC').value !== p.c) fields.c = $('edC').value;
      $('edSave').disabled = true; $('edSave').textContent = '저장 중…';
      try {
        const r = await api('update', { id: p.id, fields });
        const np = r.place;
        np._hay = [np.n, np.sd, np.sg, np.dg, np.a, np.c, np.m, np.v1, np.v2, np.t, np.memo, np.pc, np.kc, np.f, np.pf].join(' ').toLowerCase();
        const idx = S.places.indexOf(p);
        if (p._mk) { clusterer.removeMarker(p._mk); p._mk = null; }
        if (idx >= 0) S.places[idx] = np;
        S.byId[np.id] = np;
        [np.v1, np.v2].forEach(m => { if (m && S.menus.indexOf(m) < 0) S.menus.push(m); });
        store.set('mz_owner_cache', { key: S.key, categories: S.categories, prefs: S.prefs, places: S.places.map(stripPriv) });
        toast('저장했습니다'); closeSheet(); applyFilters();
      } catch (e) { toast(e.message, 3500); $('edSave').disabled = false; $('edSave').textContent = '저장'; }
    };
  }

  function friendRateForm(p) {
    return `<div class="sec"><h4>내 평가 남기기</h4>
      ${starPicker('frS', p.my || 0)}
      <div class="fld"><label>추천 메뉴 (선택)</label><input type="text" id="frM" maxlength="30" placeholder="예: 물냉면"></div>
      <div class="fld"><label>한줄평 (선택)</label><input type="text" id="frC" maxlength="100"></div>
      <button class="btn primary" id="frSave" style="width:100%">${p.my ? '평가 수정' : '평가 등록'}</button></div>`;
  }
  function bindFriendRate(p) {
    let s = p.my || 0;
    bindStars('frS', v => { s = v; });
    $('frSave').onclick = async () => {
      if (!s) return toast('별점을 선택해 주세요');
      $('frSave').disabled = true;
      try {
        const r = await api('rate', { id: p.id, score: s, comment: $('frC').value.trim(), menu: $('frM').value.trim() });
        Object.assign(p, r); toast('평가를 등록했습니다'); openPlace(p); renderList();
      } catch (e) { toast(e.message, 3500); $('frSave').disabled = false; }
    };
  }

  // ---------- 추가(본인) / 건의(친구) ----------
  function openAdd() {
    const owner = S.role === 'owner';
    openSheet(`<div class="sh-name">${owner ? '맛집 추가' : '맛집 건의하기'}</div>
      <div class="sub">카카오맵에서 <b>공유 → 링크 복사</b> 후 붙여넣거나, 식당 이름으로 검색하세요.</div>
      <div class="fld"><textarea id="adIn" placeholder="링크 붙여넣기 또는 식당명 (예: 이도곰탕 강남)"></textarea></div>
      <button class="btn primary" id="adFind" style="width:100%">찾기</button>
      <div id="adRes"></div>
      ${owner ? '' : '<div class="sec"><h4>내 건의 현황</h4><div id="mySg" class="sub">불러오는 중…</div></div>'}`);
    $('adFind').onclick = async () => {
      const t = $('adIn').value.trim(); if (!t) return;
      $('adRes').innerHTML = '<div class="sub">찾는 중…</div>';
      try {
        let docs;
        if (/https?:\/\//.test(t)) { const r = await api('resolveLink', { text: t.slice(0, 500) }); docs = r.docs; if (!docs.length) throw new Error('링크에서 식당을 찾지 못했습니다. 식당 이름으로 검색해 보세요.'); }
        else { const c = map.getCenter(); const r = await api('kakaoSearch', { q: t, x: (S.pos ? S.pos[1] : c.getLng()), y: (S.pos ? S.pos[0] : c.getLat()) }); docs = r.docs; }
        renderAddResults(docs);
      } catch (e) { $('adRes').innerHTML = `<div class="sub">${esc(e.message)}</div>`; }
    };
    if (!owner) api('mySuggestions').then(r => {
      const el = $('mySg'); if (!el) return;
      el.innerHTML = r.list.length ? r.list.map(x => `<div class="rv">${esc(x.name)} <span class="badge">${esc(x.st)}</span> <span class="sub">${esc(x.dt)}</span></div>`).join('') : '아직 건의한 식당이 없습니다.';
    }).catch(() => {});
  }

  function renderAddResults(docs) {
    const owner = S.role === 'owner';
    if (!docs.length) { $('adRes').innerHTML = '<div class="sub">검색 결과가 없습니다.</div>'; return; }
    $('adRes').innerHTML = docs.slice(0, 10).map((d, i) => {
      const exist = owner && S.places.find(p => p.k === d.id);
      return `<div class="res"><div class="nm">${esc(d.name)}${exist ? '<span class="badge b-g">이미 등록됨</span>' : ''}</div>
        <div class="sub">${esc(d.cat.replace(/^음식점 > /, ''))}</div><div class="sub">${esc(d.addr)}</div>
        ${exist ? `<button class="btn small" data-open="${esc(exist.id)}" style="width:100%">열기</button>` : `<button class="btn small" data-pick="${i}" style="width:100%">${owner ? '이 식당 추가' : '이 식당 건의'}</button>`}</div>`;
    }).join('');
    $('adRes').onclick = e => {
      const o = e.target.closest('[data-open]'); if (o) return openPlace(S.byId[o.dataset.open]);
      const b = e.target.closest('[data-pick]'); if (!b) return;
      pickDoc(docs[+b.dataset.pick]);
    };
  }

  function pickDoc(d) {
    const owner = S.role === 'owner';
    const segs = owner ? EDIT_PREFS().map(x => `<button type="button" data-pf="${esc(x)}" class="${x === '저장만' ? 'on' : ''}" style="${x === '저장만' ? 'background:' + PREF[x].color : ''}">${esc(x)}</button>`).join('') : '';
    openSheet(`<div class="sh-name">${esc(d.name)}</div><div class="sub">${esc(d.cat)}</div><div class="sub">${esc(d.addr)}</div>
      ${owner ? `<div class="fld"><label>선호도</label><div class="seg" id="npPf">${segs}</div></div>
        <div class="two"><div class="fld"><label>검증 메뉴 1</label><input type="text" id="npV1" list="menuList2"></div>
        <div class="fld"><label>검증 메뉴 2</label><input type="text" id="npV2" list="menuList2"></div></div>
        <datalist id="menuList2">${S.menus.slice(0, 800).map(m => `<option value="${esc(m)}">`).join('')}</datalist>
        <div class="fld"><label>메모</label><textarea id="npMemo" maxlength="200"></textarea></div>
        <label class="toggle"><input type="checkbox" id="npPub"> 친구에게 공개</label>`
      : `<div class="fld"><label>추천 점수</label>${starPicker('sgS', 0)}</div>
        <div class="fld"><label>추천 이유·메뉴</label><textarea id="sgR" maxlength="200" placeholder="예: 들기름막국수가 일품"></textarea></div>`}
      <button class="btn primary" id="npSave" style="width:100%;margin-top:10px">${owner ? '추가' : '건의 보내기'}</button>`);
    let pf = '저장만', s = 0;
    if (owner) {
      $('npPf').onclick = e => { const b = e.target.closest('[data-pf]'); if (!b) return; pf = b.dataset.pf;
        $('npPf').querySelectorAll('[data-pf]').forEach(x => { const on = x.dataset.pf === pf; x.classList.toggle('on', on); x.style.background = on ? PREF[x.dataset.pf].color : ''; }); };
    } else bindStars('sgS', v => { s = v; });
    $('npSave').onclick = async () => {
      $('npSave').disabled = true;
      try {
        if (owner) {
          const v1 = $('npV1').value.trim(), v2 = $('npV2').value.trim();
          if ((v1 || v2) && (pf === '저장만' || pf === '우선방문')) pf = '검증완료';
          const r = await api('addPlace', { doc: d, extra: { pf, v1, v2, memo: $('npMemo').value.trim(), pub: $('npPub').checked } });
          if (r.dup) { toast('이미 등록된 식당입니다'); return openPlace(S.byId[r.id]); }
          addLocal(r.place); toast('추가했습니다'); openPlace(S.byId[r.place.id]);
        } else {
          const r = await api('suggest', { doc: d, score: s, reason: $('sgR').value.trim() });
          toast(r.msg, 3000); closeSheet();
        }
      } catch (e) { toast(e.message, 3500); $('npSave').disabled = false; }
    };
  }

  function addLocal(np) {
    np._hay = [np.n, np.sd, np.sg, np.dg, np.a, np.c, np.m, np.v1, np.v2, np.t, np.memo, np.pc, np.kc, np.f, np.pf].join(' ').toLowerCase();
    S.places.push(np); S.byId[np.id] = np;
    store.set('mz_owner_cache', { key: S.key, categories: S.categories, prefs: S.prefs, places: S.places.map(stripPriv) });
    applyFilters();
  }

  // ---------- 건의함 (본인) ----------
  async function openInbox() {
    openSheet('<div class="sh-name">건의함</div><div id="ibList" class="sub">불러오는 중…</div>');
    try {
      const r = await api('suggestions');
      setInbox(r.list.length);
      $('ibList').innerHTML = r.list.length ? r.list.map(x => `<div class="res">
        <div class="nm">${esc(x.name)}${x.dup ? '<span class="badge b-g">이미 등록됨</span>' : ''}</div>
        <div class="sub">${esc(x.who)} · ${esc(x.dt)}${x.s ? ' · ★' + x.s : ''}</div>
        <div class="sub">${esc(x.cat)}</div><div class="sub">${esc(x.addr)}</div>
        ${x.reason ? `<div class="note">💬 ${esc(x.reason)}</div>` : ''}
        <div class="two"><button class="btn small primary" data-ok="${x.row}">승인</button><button class="btn small" data-no="${x.row}">반려</button></div></div>`).join('')
        : '대기 중인 건의가 없습니다.';
      $('ibList').onclick = async e => {
        const b = e.target.closest('[data-ok],[data-no]'); if (!b) return;
        b.disabled = true;
        try {
          const r2 = await api('decide', { row: +(b.dataset.ok || b.dataset.no), decision: b.dataset.ok ? '승인' : '반려' });
          if (r2.place) addLocal(r2.place);
          toast(b.dataset.ok ? '승인했습니다' : '반려했습니다'); openInbox();
        } catch (er) { toast(er.message, 3500); b.disabled = false; }
      };
    } catch (e) { $('ibList').textContent = e.message; }
  }
})();
