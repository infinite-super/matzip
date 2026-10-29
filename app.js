/* 호야맛집 — 화면 (GitHub Pages) */
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
    '찜한 곳': { color: '#f76707', cls: 'b-o' }, '친구추천': { color: '#1098ad', cls: 'b-j' }
  };
  const PREF_ORDER = { '검증완료': 0, '친구추천': 1, '우선방문': 2, '찜한 곳': 3 };
  const PAGE = 80;

  const S = {
    key: '', role: '', name: '', categories: [], prefs: Object.keys(PREF),
    places: [], byId: {}, filtered: [], shown: PAGE, view: 'map', pos: null, menus: [],
    f: { q: '', vm: '', cats: [], prefs: [], sido: '', sgg: '', quick: [], sort: 'auto', inView: false, st: '' },   // st: 영업 상태 ('' 폐업 제외 · sus 폐업 의심만 · all 폐업 포함)
    visit: null
  };
  let map = null, clusterer = null, meMarker = null, markerImgs = {}, visitMarker = null;

  // ---------- 키 확인 ----------
  const urlKey = new URLSearchParams(location.search).get('k');
  if (urlKey) {
    S.key = urlKey.replace(/[^A-Za-z0-9]/g, ''); store.set('mz_key', S.key);
    // 주소창에서 키를 지움 (화면 캡처·주소 복사로 키가 퍼지지 않게). 키는 이 휴대폰에만 저장됨
    try { history.replaceState(null, '', location.pathname); } catch (e) { /* 무시 */ }
  }
  else S.key = store.get('mz_key', '');
  if (!S.key) return gate('초대받은 링크로 접속해 주세요', '이 지도는 초대받은 분만 볼 수 있습니다.');
  if (!CFG.API_URL || /여기에/.test(CFG.API_URL)) return gate('설정 필요', 'config.js에 Apps Script 웹앱 주소를 입력하세요.');

  // ---------- 기기 구별 (링크 공유 방지) ----------
  // 개인정보는 읽지 않음: 이 휴대폰(브라우저)에 저장한 임의의 표시값 + 일반 명칭(휴대폰·안드로이드·크롬 등)만 서버에 보냄
  const UA = navigator.userAgent;
  const IS_IOS = /iPhone|iPad|iPod/i.test(UA);
  const IS_ANDROID = /Android/i.test(UA);
  const IN_APP = /KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|Line\/|DaumApps|everytimeApp/i.test(UA) || (IS_ANDROID && /; wv\)/.test(UA));
  const IS_STANDALONE = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  function deviceId() {
    let d = store.get('mz_dev', '');
    if (!/^[a-f0-9]{16,32}$/.test(d)) {
      const a = new Uint8Array(12); (window.crypto || window.msCrypto).getRandomValues(a);
      d = Array.from(a, b => b.toString(16).padStart(2, '0')).join(''); store.set('mz_dev', d);
    }
    return d;
  }
  function deviceLabel() {
    const kind = /iPad|Tablet/i.test(UA) || (IS_ANDROID && !/Mobile/i.test(UA)) ? '태블릿' : /Mobi|iPhone|Android/i.test(UA) ? '휴대폰' : 'PC';
    const os = IS_ANDROID ? '안드로이드' : IS_IOS ? 'iOS' : /Windows/i.test(UA) ? '윈도우' : /Mac OS/i.test(UA) ? '맥' : /Linux/i.test(UA) ? '리눅스' : '기타';
    const br = /SamsungBrowser/i.test(UA) ? '삼성인터넷' : /Edg\//.test(UA) ? '엣지' : /Whale/i.test(UA) ? '웨일' : /Firefox/i.test(UA) ? '파이어폭스'
      : /Chrome|CriOS/i.test(UA) ? '크롬' : /Safari/i.test(UA) ? '사파리' : '브라우저';
    return `${kind}·${os}·${br}${IS_STANDALONE() ? '(앱)' : ''}`;
  }
  // 카톡 등 앱 안의 브라우저: 사용하지 않고 크롬으로 안내 (설치와 등록은 크롬에서)
  if (IN_APP) {
    const g = $('gate'); g.hidden = false;
    g.innerHTML = `<h2>크롬에서 열어 주세요</h2><div>호야맛집은 크롬에서 열고, 그 화면에서 앱으로 설치해 사용합니다.</div>
      <button type="button" class="btn primary" id="gateChrome" style="margin-top:18px;width:240px">🌐 크롬으로 열기</button>
      <div class="sub" style="margin-top:10px">안 열리면 오른쪽 위 ⋮ → <b>다른 브라우저로 열기</b></div>`;
    $('gateChrome').onclick = () => openInChrome(`${location.origin}${location.pathname}?k=${encodeURIComponent(S.key)}`);
    return;
  }

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
      const p = JSON.stringify(Object.assign({ k: S.key, action, d: deviceId(), dl: deviceLabel() }, data || {}));
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

  // SVG → 카카오 마커 이미지 (ox, oy = 기준점)
  function svgImg(svg, w, h, ox, oy) {
    return new kakao.maps.MarkerImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg), new kakao.maps.Size(w, h), { offset: new kakao.maps.Point(ox, oy) });
  }
  // 저장 식당 핀: 지름 18px, 가운데 밝고 바깥 진한 그라데이션 (작아도 도드라지게)
  function shade(hex, k) {   // k<0 어둡게, k>0 밝게
    const n = parseInt(hex.slice(1), 16), f = c => Math.round(k < 0 ? c * (1 + k) : c + (255 - c) * k);
    return '#' + [n >> 16, (n >> 8) & 255, n & 255].map(f).map(x => x.toString(16).padStart(2, '0')).join('');
  }
  function pinImg(color) {
    if (markerImgs[color]) return markerImgs[color];
    const id = 'g' + color.slice(1);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22"><defs><radialGradient id="${id}" cx="35%" cy="32%" r="70%">` +
      `<stop offset="0" stop-color="${shade(color, 0.75)}"/><stop offset="0.45" stop-color="${color}"/><stop offset="1" stop-color="${shade(color, -0.45)}"/></radialGradient></defs>` +
      `<circle cx="11" cy="11.9" r="9.5" fill="rgba(0,0,0,.28)"/><circle cx="11" cy="11" r="9" fill="url(#${id})" stroke="#fff" stroke-width="1.7"/></svg>`;
    return (markerImgs[color] = svgImg(svg, 22, 22, 11, 11));
  }
  const colorOf = p => (p.ok === '폐업' ? '#adb5bd' : S.role === 'owner' ? (PREF[p.pf] || PREF['찜한 곳']).color
    : (p.ver ? PREF['검증완료'] : p.fr ? PREF['친구추천'] : PREF['찜한 곳']).color);   // 친구 화면: 검증(녹색) · 친구 추천(청록) · 찜한 곳(주황)
  const isSus = p => p.ok === '검색안됨' || p.cl === 1;   // 폐업 의심 (본인: ok, 친구: cl)

  function initMap() {
    const saved = store.get('mz_map_' + S.role, null);
    const c = saved ? saved.c : (CFG.DEFAULT_CENTER || [37.5665, 126.978]);
    map = new kakao.maps.Map($('map'), { center: new kakao.maps.LatLng(c[0], c[1]), level: saved ? saved.l : 7 });
    // 화면 크기가 바뀌면(홈 화면 앱 시작 직후, 회전, PC 창 크기) 지도를 다시 그림 — 안 하면 일부만 그려지고 나머지가 빈 칸으로 남음
    const relayout = () => { if (!map) return; const ce = map.getCenter(); map.relayout(); map.setCenter(ce); };
    let rT;
    const onResize = () => { clearTimeout(rT); rT = setTimeout(relayout, 150); };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
    if (window.ResizeObserver) new ResizeObserver(onResize).observe($('map'));
    [300, 1000].forEach(ms => setTimeout(relayout, ms));
    {
      clusterer = new kakao.maps.MarkerClusterer({ map, averageCenter: true, minLevel: 8, gridSize: 50, minClusterSize: 3,
        styles: [{ width: '26px', height: '26px', background: 'radial-gradient(circle at 35% 32%, #74c0fc, #1c7ed6 55%, #0b4f8a)', border: '1.5px solid #fff', boxShadow: '0 1px 3px rgba(0,0,0,.35)', borderRadius: '50%', color: '#fff', textAlign: 'center', lineHeight: '23px', fontWeight: '700', fontSize: '10px', boxSizing: 'border-box' }] });
    }
    let idleT;
    kakao.maps.event.addListener(map, 'idle', () => {
      const ce = map.getCenter();
      store.set('mz_map_' + S.role, { c: [ce.getLat(), ce.getLng()], l: map.getLevel() });
      clearTimeout(idleT);
      idleT = setTimeout(() => {
        if (S.f.inView && S.view === 'list') applyFilters(true);
      }, 350);
    });
  }

  // ---------- 시작 ----------
  window.addEventListener('error', e => { if (!$('gate').hidden) return; banner('오류: ' + (e.message || '알 수 없음') + ' — 화면을 캡처해 알려 주세요'); });
  window.addEventListener('unhandledrejection', e => { const m = e.reason && e.reason.message; if (m) banner('오류: ' + m); });
  $('mapCount').textContent = '불러오는 중…';

  async function start() {
    try {
      try { localStorage.removeItem('mz_owner_cache'); } catch (e) { /* 예전 저장 형식 정리 */ }
      const cached = store.get('mz_cache', null);
      const kakaoP = loadKakao();
      const useCache = cached && cached.key === S.key && cached.places;
      let initP = api('init', useCache && cached.ver ? { ver: cached.ver } : {});   // 바뀐 게 없으면 서버가 목록을 다시 보내지 않음
      let data;
      if (useCache) {   // 이전 데이터로 먼저 표시 후 새로 고침
        data = { role: cached.role, name: cached.name, categories: cached.categories, prefs: cached.prefs, places: cached.places, pending: 0, ver: cached.ver };
      } else {
        data = await initP; initP = null;
      }
      await kakaoP.catch(e => { throw new Error(e.message + '\n(카카오 JavaScript 키와 사이트 도메인 등록을 확인하세요)'); });
      boot(data);
      if (initP) {
        initP.then(fresh => {
          if (fresh.role !== S.role) return;
          if (fresh.same) { if (S.role === 'owner') setInbox(fresh.pending || 0); return; }   // 그대로면 다시 그리지 않음
          setData(fresh); applyFilters();
        })
          .catch(e => { if (/초대|기기/.test(e.message)) { store.set('mz_cache', null); gate(/기기/.test(e.message) ? '등록되지 않은 기기' : '접속 권한 없음', e.message); } });
      }
    } catch (e) {
      if (/초대|기기/.test(e.message)) { store.set('mz_cache', null); gate(/기기/.test(e.message) ? '등록되지 않은 기기' : '접속 권한 없음', e.message); }
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
    setData(data); applyFilters();
    if (S.role === 'friend') toast(`${S.name}님, 환영합니다`);
    // 지도 색 범례 (오른쪽 위)
    $('legend').innerHTML = (S.role === 'owner' ? EDIT_PREFS().map(x => [PREF[x].color, x]) : [[PREF['검증완료'].color, '검증'], [PREF['친구추천'].color, '친구 추천'], [PREF['찜한 곳'].color, '찜한 곳']])
      .map(([c, t]) => `<span><i style="background:${c}"></i>${esc(t)}</span>`).join('');
    setView(S.view);
    locate(true, true);   // 시작하면 내 위치 주변으로
    setTimeout(showInstallBar, 1500);
  }

  function setData(d) {
    S.ver = d.ver || '';
    S.places = d.places || [];
    S.byId = {};
    const menus = new Set();
    S.places.forEach(p => {
      S.byId[p.id] = p;
      [p.v1, p.v2].concat(String(p.m || '').split(',')).forEach(x => { x = String(x || '').trim(); if (x) menus.add(x); });
      indexPlace(p);
    });
    S.menus = Array.from(menus).sort();
    if (d.prefs) S.prefs = d.prefs;
    fillRegions();
    if (S.role === 'owner') setInbox(d.pending || 0);
    if (clusterer) { clusterer.clear(); S.places.forEach(p => { p._mk = null; }); }
    saveCache(true);
  }
  // 검색용 문자열 (이름·지역·메뉴·메모 등)
  function indexPlace(p) { p._hay = [p.n, p.sd, p.sg, p.dg, p.a, p.c, p.m, p.v1, p.v2, p.t, p.memo, p.pc, p.kc, p.f, p.pf].join(' ').toLowerCase(); return p; }
  // 받은 데이터를 휴대폰에 저장 (다음 실행 때 바로 표시)
  function saveCache(keepVer) {
    if (!keepVer) S.ver = '';
    const strip = p => { const q = Object.assign({}, p); delete q._mk; delete q._hay; delete q._d; return q; };
    store.set('mz_cache', { key: S.key, role: S.role, name: S.name, categories: S.categories, prefs: S.prefs, places: S.places.map(strip), ver: S.ver });
  }

  function setInbox(n) { const b = $('inboxBadge'); b.hidden = !n; b.textContent = n; }

  // ---------- 필터 UI ----------
  // 상단 원탭 칩 (하나만 선택, 다시 누르면 해제) — 나머지 분류는 ⚙ 필터에서
  const QUICK_OWNER = [{ id: 'all', label: '전체' }, { id: 'pri', label: '우선방문' }, { id: 'ver', label: '검증완료' }];
  const QUICK_FRIEND = [{ id: 'all', label: '전체' }, { id: 'ver', label: '✔ 검증된 곳' }];
  const QUICK_CATS = ['한식', '중식', '일식', '분식'];
  const QUICK_LABEL = { pri: '우선방문', ver: '검증완료' };
  const EDIT_PREFS = () => S.prefs.filter(x => PREF[x]);
  const origin = () => (S.visit ? [S.visit.la, S.visit.lo] : S.pos);

  function activeQuick() {
    if (S.f.quick.length === 1 && !S.f.cats.length && !S.f.prefs.length) return 'q:' + S.f.quick[0];
    if (S.f.cats.length === 1 && !S.f.quick.length && !S.f.prefs.length) return 'c:' + S.f.cats[0];
    return '';
  }
  function filterLabel() {
    const parts = S.f.quick.map(x => QUICK_LABEL[x] || x).concat(S.f.cats, S.f.prefs, S.f.sgg || S.f.sido || [], S.f.q ? ['"' + S.f.q + '"'] : [], S.f.vm ? ['🍴' + S.f.vm] : [], S.f.st === 'sus' ? ['폐업 의심'] : S.f.st === 'all' ? ['폐업 포함'] : []);
    const base = parts.length ? parts.join(' · ') : '전체';
    return S.visit ? `📍${S.visit.name} · ${base}` : base;
  }

  function buildChips() {
    const quick = S.role === 'owner' ? QUICK_OWNER : QUICK_FRIEND;
    const act = activeQuick();
    const none = !S.f.quick.length && !S.f.cats.length && !S.f.prefs.length && !S.f.q && !S.f.vm && !S.f.sido && !S.f.sgg;
    $('quick').innerHTML = quick.map(c => `<button class="chip${(c.id === 'all' ? none : act === 'q:' + c.id) ? ' on' : ''}" data-q="${c.id}">${c.label}</button>`).join('') +
      QUICK_CATS.map(c => `<button class="chip${act === 'c:' + c ? ' on' : ''}" data-c="${esc(c)}">${esc(c)}</button>`).join('');
    $('catChips').innerHTML = S.categories.map(c => `<button class="chip${S.f.cats.indexOf(c) >= 0 ? ' on' : ''}" data-c="${esc(c)}">${esc(c)}</button>`).join('');
    $('prefChips').innerHTML = EDIT_PREFS().map(p => `<button class="chip${S.f.prefs.indexOf(p) >= 0 ? ' on' : ''}" data-p="${esc(p)}">${esc(p)}</button>`).join('');
  }

  // 조건 초기화 (방문지·정렬·지도 범위 설정은 유지)
  function clearFilters(extra) {
    Object.assign(S.f, { q: '', vm: '', quick: [], cats: [], prefs: [], sido: '', sgg: '' }, extra || {});
    $('q').value = '';
    fillRegions();
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
    if (['auto', 'dist', 'recent'].indexOf(S.f.sort) < 0) S.f.sort = 'auto';   // 삭제된 정렬(평점 순)은 자동으로
    $('sort').value = S.f.sort;
    S.f.st = ['', 'sus', 'all'].indexOf(S.f.st) >= 0 ? S.f.st : ''; $('stSel').value = S.f.st;
    $('inView').checked = !!S.f.inView;
  }
  function saveUI() { store.set('mz_filters', Object.assign({}, S.f, { q: '', vm: '' })); store.set('mz_view', S.view); }

  let bound = false;
  function bindUI() {
    if (bound) return; bound = true;
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-q],[data-c],[data-p]');
      if (!b || !b.closest('#top')) return;
      if (b.closest('#quick')) {
        // 원탭 칩: 하나만 선택 (같은 칩 다시 누르면 전체 보기)
        const qid = b.dataset.q;
        if (qid === 'all') clearFilters();   // 전체: 분류·검색어·메뉴·지역 해제 (선택한 방문지는 유지)
        else {
          const key = qid ? 'q:' + qid : 'c:' + b.dataset.c;
          const same = activeQuick() === key;
          S.f.quick = []; S.f.cats = []; S.f.prefs = [];
          S.f.vm = '';
          if (!same) { if (qid) S.f.quick = [qid]; else S.f.cats = [b.dataset.c]; }
        }
      } else if (b.dataset.c) toggleArr(S.f.cats, b.dataset.c);
      else if (b.dataset.p) toggleArr(S.f.prefs, b.dataset.p);
      buildChips(); saveUI(); refresh();
      noticeIfNoneInView();
    });
    $('q').addEventListener('input', () => {   // 입력 중에는 아무것도 바꾸지 않음. 지우면 검색 해제
      if (!$('q').value.trim() && S.f.q) { S.f.q = ''; buildChips(); refresh(); }
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
    $('stSel').onchange = () => { S.f.st = $('stSel').value; saveUI(); closeFilter(); applyFilters(); if (S.f.st === 'sus' && S.filtered.length) setView('list'); };
    $('inView').onchange = () => { S.f.inView = $('inView').checked; saveUI(); applyFilters(true); };
    $('btnReset').onclick = () => { clearFilters({ sort: 'auto', inView: false, st: '' }); $('sort').value = 'auto'; $('inView').checked = false; $('stSel').value = ''; buildChips(); saveUI(); refresh(); };
    document.querySelectorAll('#bottom [data-view]').forEach(b => { b.onclick = () => setView(b.dataset.view); });
    $('btnLocate').onclick = () => locate(true);
    $('btnMenu').onclick = openMenus;
    $('btnAdd').onclick = openAdd;
    let adScrollT = 0;
    $('addPanel').addEventListener('scroll', e => {
      if (e.target.id !== 'adRes' || !isPhone() || !addDocs.length) return;
      clearTimeout(adScrollT);
      adScrollT = setTimeout(() => {
        const box = $('adRes'), mid = box.scrollLeft + box.clientWidth / 2;
        let best = 0, bd = 1e9;
        box.querySelectorAll('.ad').forEach(x => { const c = x.offsetLeft + x.offsetWidth / 2; if (Math.abs(c - mid) < bd) { bd = Math.abs(c - mid); best = +x.dataset.row; } });
        focusAdd(best, true, true);
      }, 140);
    }, true);
    $('addPanel').addEventListener('click', e => {
      if (e.target.closest('a')) return;
      const o = e.target.closest('[data-open]'); if (o) return openPlace(S.byId[o.dataset.open]);
      const b = e.target.closest('[data-pick]'); if (b) return pickDoc(addDocs[+b.dataset.pick]);
      const r = e.target.closest('[data-row]'); if (r) focusAdd(+r.dataset.row);
    });
    $('btnInbox').onclick = openInbox;
    $('more').onclick = () => { S.shown += PAGE; renderList(); };
    $('list').onclick = e => { const li = e.target.closest('li[data-i]'); if (li) openPlace(S.filtered[+li.dataset.i]); };
    $('sheetBack').onclick = closeSheet;
    $('sheetX').onclick = closeSheet;
    window.addEventListener('popstate', () => { if (!$('sheet').hidden) hideSheet(); });
  }

  // 칩을 바꿔도 지도는 움직이지 않음 (지도 이동은 사용자가 직접, 또는 장소·식당을 골랐을 때만)
  // 지금 화면에 해당 식당이 하나도 없으면, 가장 가까운 곳을 알려 주기만 함
  function noticeIfNoneInView() {
    if (!map || !S.filtered.length || S.view !== 'map') return;
    const b = map.getBounds();
    if (S.filtered.some(p => b.contain(new kakao.maps.LatLng(p.la, p.lo)))) return;
    const c = map.getCenter(), o = [c.getLat(), c.getLng()];
    let best = null, bd = Infinity;
    S.filtered.forEach(p => { const d = dist(o, [p.la, p.lo]); if (d < bd) { bd = d; best = p; } });
    if (best) toast(`이 화면에는 없습니다 · 가장 가까운 곳: ${best.n} (${fmtDist(bd)})`, 3500);
  }
  function setMapCount(n) {
    const el = $('mapCount');
    el.textContent = `${filterLabel()} · ${n.toLocaleString()}곳`;
  }

  function refresh() { applyFilters(); }

  function setView(v) {
    if (v === 'list' && $('addPanel') && !$('addPanel').hidden) closeAdd();
    S.view = v; saveUI();
    $('listView').hidden = v !== 'list';
    document.querySelectorAll('#bottom [data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === v));
    if (v === 'map' && map) setTimeout(() => map.relayout(), 0);
    if (v === 'list') { if (S.f.inView) applyFilters(true); else renderList(); }
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
        meMarker = new kakao.maps.Marker({ position: ll, zIndex: 10, image: svgImg(svg, 22, 22, 11, 11) });
        meMarker.setMap(map);
      } else meMarker.setPosition(ll);
      if (moveMap && S.visit && !initial) clearVisit(true);   // 내 위치 버튼 = 방문지 해제
      if (moveMap && !S.visit) { map.setLevel(5); map.setCenter(ll); }
      if (S.f.sort === 'auto' || S.f.sort === 'dist') refresh();
    }, () => toast(initial ? '위치 권한을 허용하면 내 주변부터 보여줍니다' : '위치 권한을 허용해 주세요', 3000), // 위치는 필요할 때 한 번만 확인 (계속 추적하지 않음).
      // 앱 시작 때: GPS 대신 와이파이·기지국 위치(빠르고 배터리 적게), 5분 안의 위치는 다시 쓰기 / 내 위치 버튼: GPS로 정확하게
      initial ? { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 } : { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
  }

  function dist(a, b) {
    const R = 6371000, r = x => x * Math.PI / 180;
    const dLa = r(b[0] - a[0]), dLo = r(b[1] - a[1]);
    const h = Math.sin(dLa / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dLo / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const fmtDist = m => (m < 1000 ? Math.round(m) + 'm' : (m / 1000).toFixed(1) + 'km');

  // 지역(시도·시군구)을 직접 고른 경우에만 그 지역 전체가 보이게 지도를 맞춤
  // ---------- 필터 (본인·친구 공통, 휴대폰에서 바로 거름) ----------
  const isVer = p => (S.role === 'owner' ? p.pf === '검증완료' : p.ver);
  function applyFilters(listOnly) {
    if (!map) return;
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
      if (q.indexOf('pri') >= 0 && p.pf !== '우선방문') return false;
      if (q.indexOf('ver') >= 0 && !isVer(p)) return false;
      if (toks.length && !toks.every(t => p._hay.indexOf(t) >= 0)) return false;
      if (f.vm && p.v1 !== f.vm && p.v2 !== f.vm) return false;
      if (f.st !== 'all' && p.ok === '폐업') return false;
      if (f.st === 'sus' && !isSus(p)) return false;
      if (b && !b.contain(new kakao.maps.LatLng(p.la, p.lo))) return false;
      return true;
    });
    const vmHit = p => (toks.length && toks.some(t => (p.v1 + ' ' + p.v2).toLowerCase().indexOf(t) >= 0) ? 1 : 0);
    const prefSort = (a, b2) => (S.role === 'owner' ? PREF_ORDER[a.pf] - PREF_ORDER[b2.pf] : isVer(b2) - isVer(a)) || ((b2.rn || 0) - (a.rn || 0));
    const sorts = {
      dist: (a, b2) => (a._d || 0) - (b2._d || 0),
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
    clusterer.clear();
    clusterer.addMarkers(S.filtered.map(markerFor), true);   // 다 넣은 뒤 한 번만 그림
    if (clusterer.redraw) clusterer.redraw();
  }

  function fitFiltered() {
    if (!map || !S.filtered.length) return;
    const bd = new kakao.maps.LatLngBounds();
    S.filtered.slice(0, 2000).forEach(p => bd.extend(new kakao.maps.LatLng(p.la, p.lo)));
    map.setBounds(bd);
  }

  // ---------- 🍴 검증 메뉴 검색 ----------
  function openMenus() {
    closeFilter();
    if (!$('addPanel').hidden) closeAdd();
    openSheet(`<div class="sh-name">🍴 검증 메뉴로 찾기</div>
      <div class="sub">직접 먹어 보고 검증한 대표 메뉴입니다. 고르면 그 메뉴로 검증된 식당을 가까운 순으로 보여줍니다.</div>
      <div class="fld"><input type="text" id="mnIn" placeholder="메뉴 이름 (예: 냉면)" autocomplete="off" style="width:100%"></div>
      <div id="mnChips" class="chips wrap"><span class="sub">불러오는 중…</span></div>`);
    let list = [];
    const draw = () => {
      const el = $('mnChips'); if (!el) return;
      const t = $('mnIn').value.trim().toLowerCase().replace(/\s+/g, '');
      const arr = t ? list.filter(x => x.m.toLowerCase().replace(/\s+/g, '').indexOf(t) >= 0) : list;
      el.innerHTML = arr.length ? arr.slice(0, 200).map(x => `<button type="button" class="chip${S.f.vm === x.m ? ' on' : ''}" data-m="${esc(x.m)}">${esc(x.m)} <b class="cnt">${x.n}</b></button>`).join('')
        : `<span class="sub">${list.length ? '일치하는 메뉴가 없습니다.' : '아직 검증 메뉴가 저장된 식당이 없습니다.'}</span>`;
    };
    $('mnIn').addEventListener('input', draw);
    $('mnChips').onclick = e => { const b = e.target.closest('[data-m]'); if (b) setMenu(b.dataset.m); };
    const c = {};
    S.places.forEach(p => [p.v1, p.v2].forEach(m => { m = String(m || '').trim(); if (m) c[m] = (c[m] || 0) + 1; }));
    list = Object.keys(c).map(m => ({ m, n: c[m] })).sort((a, b) => (b.n - a.n) || a.m.localeCompare(b.m, 'ko'));
    draw();
  }
  function setMenu(m) {
    clearFilters({ vm: m });
    buildChips();
    hideSheetThen(() => { applyFilters(); setView('list'); });
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
  function foodSearch(q) {
    clearFilters({ q }); $('q').value = q;
    buildChips(); applyFilters();
    if (!S.filtered.length) { toast('일치하는 식당이 없습니다'); return; }
    setView('list');
  }

  // ---------- 장소 검색(카카오) ----------
  async function openSearch() {
    const q = $('q').value.trim();
    $('q').blur(); closeFilter();
    if (!q) return;
    if (S.mode === 'food') return foodSearch(q);
    const owner = S.role === 'owner';
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
        hideSheetThen(() => goPlace(p));
      };
      if (list.length > 3) $('srMineGo').onclick = () => {
        clearFilters({ q }); $('q').value = q;
        buildChips(); applyFilters();
        hideSheetThen(() => setView('list'));
      };
    };
    {
      const toks = q.toLowerCase().split(/\s+/).filter(Boolean);
      const hits = S.places.filter(p => toks.every(t => p._hay.indexOf(t) >= 0));
      const nm = q.replace(/\s+/g, '').toLowerCase();   // 이름이 일치하는 식당을 먼저
      hits.sort((a, b) => (b.n.replace(/\s+/g, '').toLowerCase().indexOf(nm) >= 0) - (a.n.replace(/\s+/g, '').toLowerCase().indexOf(nm) >= 0)
        || ((a._d == null ? 1e12 : a._d) - (b._d == null ? 1e12 : b._d)));   // 다음은 가까운 순
      showMine(hits);
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
    if (S.filtered.indexOf(p) < 0) {   // 칩·필터에 가려지지 않게 해제
      clearFilters(); buildChips(); applyFilters();
    }
    setView('map');
    map.setLevel(3);
    map.setCenter(new kakao.maps.LatLng(p.la, p.lo));
    openPlace(p);
  }
  function setVisit(v) {
    S.visit = v; closeFilter();
    S.f.q = ''; $('q').value = '';
    drawVisit(); buildChips();
    applyFilters();
    toast(`${v.name} 주변 · 가까운 순`);
  }
  function clearVisit(silent) {
    S.visit = null; drawVisit(); buildChips();
    if (!silent) refresh();
  }
  function drawVisit() {
    if (visitMarker) { visitMarker.setMap(null); visitMarker = null; }
    if (!S.visit || !map) return;
    const v = S.visit, c = new kakao.maps.LatLng(v.la, v.lo);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="40"><path d="M15 1C7.3 1 1 7.1 1 14.7 1 25 15 39 15 39s14-14 14-24.3C29 7.1 22.7 1 15 1z" fill="#e03131" stroke="#fff" stroke-width="2"/><circle cx="15" cy="15" r="5" fill="#fff"/></svg>';
    visitMarker = new kakao.maps.Marker({ position: c, zIndex: 20, title: v.name, image: svgImg(svg, 30, 40, 15, 39) });
    visitMarker.setMap(map);
    map.setLevel(VISIT_LEVEL);
    map.setCenter(c);
  }

  // ---------- 목록 ----------
  function prefBadge(p) {
    if (S.role !== 'owner') return (p.ver ? '<span class="badge b-g">✔ 검증</span>' : p.fr ? '<span class="badge b-j">친구 추천</span>' : '<span class="badge b-o">찜한 곳</span>') + (p.cl ? '<span class="badge b-w">폐업?</span>' : '');
    const pr = PREF[p.pf] || PREF['찜한 곳'];
    return `<span class="badge ${pr.cls}">${esc(p.pf)}</span>` + (p.pub ? '<span class="badge b-pub">공개</span>' : '') + (p.ok === '검색안됨' ? '<span class="badge b-w">폐업?</span>' : p.ok === '폐업' ? '<span class="badge">폐업</span>' : '');
  }

  function renderList() {
    if (S.view !== 'list') return;
    const items = S.filtered.slice(0, S.shown).map((p, i) => {
      const vm = [p.v1, p.v2].filter(Boolean).join(' · ');
      const extra = [];
      if (p.rn) extra.push('💬' + p.rn);   // 지인 한줄평 수
      if (p._d != null && origin()) extra.push(fmtDist(p._d));
      const note = S.role === 'owner' ? (p.memo || p.pc) : p.pc;
      return `<li data-i="${i}"><div class="nm"><span class="dot" style="background:${colorOf(p)}"></span>${esc(p.n)}${prefBadge(p)}</div>
        <div class="sub">${esc([p.sd, p.sg].filter(Boolean).join(' '))} · ${esc(p.c)}${p.m ? ' · ' + esc(p.m) : ''}${extra.length ? ' · ' + esc(extra.join(' · ')) : ''}</div>
        ${vm ? `<div class="vm">✔ ${esc(vm)}</div>` : ''}${note ? `<div class="note">${esc(note)}</div>` : ''}</li>`;
    });
    $('list').innerHTML = items.join('') || '<li class="sub">조건에 맞는 식당이 없습니다.</li>';
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
  function tmapUrl(p) { const n = encodeURIComponent(p.n);
    return IS_IOS ? `tmap://route?rGoName=${n}&rGoX=${p.lo}&rGoY=${p.la}` : `tmap://route?goalname=${n}&goalx=${p.lo}&goaly=${p.la}`; }
  function kakaoUrl(p) { return p.k && !isSus(p) && p.ok !== '폐업' ? `https://place.map.kakao.com/${encodeURIComponent(p.k)}` : `https://map.kakao.com/link/search/${encodeURIComponent(p.n)}`; }

  function openPlace(p) {
    if (!p) return;
    const vm = [p.v1, p.v2].filter(Boolean).join(' · ');
    let html = `<div class="sh-name">${esc(p.n)}</div>${closureBox(p)}
      ${S.role === 'owner' ? `<div class="fld" style="margin-top:10px"><label>상태 (누르면 바로 저장)</label>${prefSeg('qPf', p.pf)}</div>` : ''}
      <div class="sub" style="margin-top:6px">${prefBadge(p)}</div>
      <div class="sub">${esc(p.c)}${p.m ? ' · ' + esc(p.m) : ''}${p.t ? ' · #' + esc(p.t.split(', ').join(' #')) : ''}</div>
      ${vm ? `<div class="vm" style="font-size:16px">✔ 검증 메뉴: ${esc(vm)}</div>` : ''}
      ${p._d != null && origin() ? `<div class="sub">${fmtDist(p._d)}</div>` : ''}
      ${p.pc ? `<div class="note">💬 ${S.role === 'owner' ? '내 한줄평' : '추천인 한줄평'}: ${esc(p.pc)}</div>` : ''}
      ${S.role === 'owner' && p.memo ? `<div class="note">📝 ${esc(p.memo)}</div>` : ''}
      <div class="sub">${esc(p.a)}</div>
      <div class="acts">
        <a class="btn primary" id="goTmap" href="${tmapUrl(p)}">🚗 티맵 길찾기</a>
        <a class="btn" href="${kakaoUrl(p)}" target="_blank" rel="noopener">ℹ️ 카카오맵 상세</a>
        <button class="btn" id="copyAddr">📋 주소 복사</button>
      </div>`;
    html += S.role === 'owner' ? ownerEditForm(p) : friendNoteForm(p);
    html += `<div class="sec"><h4>지인 한줄평</h4><div id="rvList" class="sub">불러오는 중…</div></div>`;
    openSheet(html);
    $('copyAddr').onclick = () => { (navigator.clipboard ? navigator.clipboard.writeText(p.a) : Promise.reject()).then(() => toast('주소를 복사했습니다'), () => toast(p.a, 4000)); };
    $('goTmap').addEventListener('click', () => { setTimeout(() => { if (!document.hidden) toast('티맵이 열리지 않으면 앱 설치 여부를 확인하세요', 3500); }, 1800); });
    if (map && S.view === 'map') map.panTo(new kakao.maps.LatLng(p.la, p.lo));
    if (S.role === 'owner') { bindOwnerEdit(p); bindClosure(p); } else bindFriendNote(p);
    api('detail', { id: p.id }).then(r => {
      const el = $('rvList'); if (!el) return;
      el.innerHTML = r.notes.length ? r.notes.map(x => `<div class="rv"><b>${esc(x.who)}</b> <span class="sub">${esc(x.dt)}</span><div>${esc(x.cm)}</div></div>`).join('') : '아직 지인 한줄평이 없습니다.';
    }).catch(() => { const el = $('rvList'); if (el) el.textContent = '한줄평을 불러오지 못했습니다.'; });
  }

  // 폐업 의심·폐업 안내 (정보창 맨 위)
  function closureBox(p) {
    if (S.role !== 'owner') return p.cl ? '<div class="warn">⚠ <b>폐업 의심</b> — 최근 카카오맵에서 검색되지 않습니다. 방문 전 영업 여부를 확인하세요.</div>' : '';
    if (p.ok === '검색안됨') return `<div class="warn">⚠ <b>폐업 의심</b> — 카카오맵에서 ${p.ms > 1 ? p.ms + '회 연속 ' : ''}검색되지 않았습니다${p.ck ? ' (' + esc(p.ck) + ' 점검)' : ''}. 상호 변경·이전일 수도 있습니다.
      <div class="two" style="margin-top:8px"><button class="btn small" data-ok="수동확인">영업 중 맞음</button><button class="btn small" data-ok="폐업">폐업 처리</button></div></div>`;
    if (p.ok === '폐업') return `<div class="warn gray">폐업 처리한 식당입니다. 친구 화면과 기본 지도에서는 보이지 않습니다.
      <button class="btn small" data-ok="OK" style="width:100%;margin-top:8px">되살리기</button></div>`;
    return '';
  }
  function bindClosure(p) {
    document.querySelectorAll('#sheetBody [data-ok]').forEach(b => {
      b.onclick = async () => {
        b.disabled = true;
        try {
          const r = await api('update', { id: p.id, fields: { ok: b.dataset.ok } });
          replacePlace(p, r.place);
          toast({ 수동확인: '영업 중으로 표시했습니다 (자동 점검에서 제외)', 폐업: '폐업 처리했습니다', OK: '되살렸습니다' }[b.dataset.ok]);
          closeSheet(); applyFilters();
        } catch (e) { toast(e.message, 3500); b.disabled = false; }
      };
    });
  }
  // 서버에서 받은 수정본으로 교체
  function replacePlace(p, np) {
    indexPlace(np);
    const idx = S.places.indexOf(p);
    if (p._mk) { clusterer.removeMarker(p._mk); p._mk = null; }
    if (idx >= 0) S.places[idx] = np;
    S.byId[np.id] = np;
    [np.v1, np.v2].forEach(m => { if (m && S.menus.indexOf(m) < 0) S.menus.push(m); });
    saveCache();
    return np;
  }

  // 선호도 선택 버튼 (수정·추가 화면 공통)
  function prefSeg(id, sel) {
    return `<div class="seg" id="${id}">` + EDIT_PREFS().map(x => `<button type="button" data-pf="${esc(x)}" class="${x === sel ? 'on' : ''}" style="${x === sel ? 'background:' + PREF[x].color : ''}">${esc(x)}</button>`).join('') + '</div>';
  }
  function bindPrefSeg(id, cb) {
    $(id).onclick = e => {
      const b = e.target.closest('[data-pf]'); if (!b) return;
      $(id).querySelectorAll('[data-pf]').forEach(x => { const on = x === b; x.classList.toggle('on', on); x.style.background = on ? PREF[x.dataset.pf].color : ''; });
      cb(b.dataset.pf);
    };
  }

  const menuDatalist = () => `<datalist id="menuList">${S.menus.slice(0, 800).map(m => `<option value="${esc(m)}">`).join('')}</datalist>`;
  function ownerEditForm(p) {
    return `<div class="sec"><h4>내 기록</h4>
      <div class="two">
        <div class="fld"><label>검증 메뉴 1</label><input type="text" id="edV1" list="menuList" value="${esc(p.v1)}" placeholder="예: 평양냉면"></div>
        <div class="fld"><label>검증 메뉴 2</label><input type="text" id="edV2" list="menuList" value="${esc(p.v2)}" placeholder="예: 수육"></div>
      </div>
      ${menuDatalist()}
      <div class="two">
        <label class="toggle"><input type="checkbox" id="edV" ${p.v ? 'checked' : ''}> 방문함</label>
        <label class="toggle"><input type="checkbox" id="edPub" ${p.pub ? 'checked' : ''}> 친구에게 공개</label>
      </div>
      <div class="fld"><label>내 한줄평 · 방문 인상 (친구에게 보임)</label><input type="text" id="edPc" value="${esc(p.pc)}" maxlength="100"></div>
      <div class="fld"><label>개인 메모 (본인만)</label><textarea id="edMemo" maxlength="200">${esc(p.memo)}</textarea></div>
      <div class="fld"><label>대분류 ${p.kc ? '(카카오: ' + esc(p.kc) + ')' : ''}</label>
        <select id="edC">${S.categories.map(c => `<option${c === p.c ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
      <button class="btn primary" id="edSave" style="width:100%">저장</button>
      ${p.f ? `<div class="sub" style="margin-top:8px">카카오 폴더: ${esc(p.f)}</div>` : ''}
      <button class="btn small danger" id="edDel" style="width:100%;margin-top:14px">🗑 이 식당 삭제</button></div>`;
  }

  function bindOwnerEdit(p) {
    let cur = p;   // 상태를 바로 바꾸면 새 데이터로 교체되므로 현재 것을 따로 기억
    // 상태: 누르는 즉시 저장 (검증완료로 바꾸면 '방문함'도 함께 체크)
    bindPrefSeg('qPf', async v => {
      if (v === cur.pf) return;
      const fields = { pf: v }; if (v === '검증완료') { fields.v = true; $('edV').checked = true; }
      try {
        const r = await api('update', { id: cur.id, fields });
        cur = replacePlace(cur, r.place);
        toast(`'${v}'(으)로 바꿨습니다`); applyFilters();
      } catch (e) { toast(e.message, 3500); }
    });
    // 삭제: 두 번 눌러야 삭제 (실수 방지). 지운 식당은 구글 시트 '삭제된식당'에 보관
    let armed = 0;
    $('edDel').onclick = async () => {
      const b = $('edDel');
      if (!armed) { armed = setTimeout(() => { armed = 0; b.textContent = '🗑 이 식당 삭제'; b.classList.remove('armed'); }, 4000); b.textContent = '정말 삭제할까요? 한 번 더 누르면 삭제됩니다'; b.classList.add('armed'); return; }
      clearTimeout(armed); b.disabled = true; b.textContent = '삭제 중…';
      try {
        await api('delete', { id: cur.id });
        if (cur._mk) { clusterer.removeMarker(cur._mk); cur._mk = null; }
        S.places = S.places.filter(x => x !== cur); delete S.byId[cur.id];
        saveCache(); closeSheet(); applyFilters();
        toast(`'${cur.n}'을(를) 삭제했습니다 (구글 시트 '삭제된식당'에 보관)`, 3500);
      } catch (e) { toast(e.message, 3500); b.disabled = false; b.textContent = '🗑 이 식당 삭제'; armed = 0; }
    };
    const v1el = $('edV1'), v2el = $('edV2');
    $('edSave').onclick = async () => {
      // 검증 메뉴를 넣으면 서버가 자동으로 검증완료로 바꿈
      const fields = { v1: v1el.value.trim(), v2: v2el.value.trim(), v: $('edV').checked, pub: $('edPub').checked,
        pc: $('edPc').value.trim(), memo: $('edMemo').value.trim() };
      if ($('edC').value !== cur.c) fields.c = $('edC').value;
      $('edSave').disabled = true; $('edSave').textContent = '저장 중…';
      try {
        const r = await api('update', { id: cur.id, fields });
        replacePlace(cur, r.place);
        toast('저장했습니다'); closeSheet(); applyFilters();
      } catch (e) { toast(e.message, 3500); $('edSave').disabled = false; $('edSave').textContent = '저장'; }
    };
  }

  function friendNoteForm(p) {
    return `<div class="sec"><h4>${p.my ? '내 한줄평 고치기' : '한줄평 남기기'}</h4>
      <div class="fld"><input type="text" id="frC" maxlength="100" value="${esc(p.my || '')}" placeholder="추천 이유를 한 줄로 (예: 육수가 깔끔해요)" style="width:100%"></div>
      <div class="sub" style="margin:-2px 0 8px">다른 친구에게는 이름 없이 '지인'으로 보입니다.${p.my ? ' 내용을 지우고 저장하면 삭제됩니다.' : ''}</div>
      <button class="btn primary" id="frSave" style="width:100%">저장</button></div>`;
  }
  function bindFriendNote(p) {
    $('frSave').onclick = async () => {
      const cm = $('frC').value.trim();
      if (!cm && !p.my) return toast('한줄평을 입력해 주세요');
      $('frSave').disabled = true;
      try {
        const r = await api('note', { id: p.id, comment: cm });
        p.rn = r.rn; if (r.my) p.my = r.my; else delete p.my;
        saveCache(); toast(cm ? '한줄평을 저장했습니다' : '한줄평을 삭제했습니다'); openPlace(p); renderList();
      } catch (e) { toast(e.message, 3500); $('frSave').disabled = false; }
    };
  }

  // ---------- 맛집 추가(본인)·건의(친구): PC 왼쪽 목록 / 휴대폰 아래 카드 + 지도 번호 핀 ----------
  let addMarkers = [], addDocs = [], addCur = -1;
  function numImg(n, on) {
    const sz = on ? 36 : 28, col = on ? '#1c7ed6' : '#e03131';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${sz}" height="${sz}"><circle cx="${sz / 2}" cy="${sz / 2}" r="${sz / 2 - 2}" fill="${col}" stroke="#fff" stroke-width="2"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-size="${on ? 17 : 14}" font-weight="700" fill="#fff" font-family="sans-serif">${n}</text></svg>`;
    return svgImg(svg, sz, sz, sz / 2, sz / 2);
  }
  function clearAddMarkers() { addMarkers.forEach(m => m.setMap(null)); addMarkers = []; addDocs = []; addCur = -1; }
  // 화면 크기별 배치: PC = 왼쪽 목록, 휴대폰 = 아래쪽 카드(옆으로 넘김)
  const isPhone = () => window.matchMedia('(max-width: 699px)').matches;
  function panelPad() {
    const el = $('addPanel'); if (!el || el.hidden) return { l: 0, b: 0 };
    return isPhone() ? { l: 0, b: el.offsetHeight + 8 } : { l: el.offsetWidth, b: 0 };
  }
  function closeAdd() { $('addPanel').hidden = true; clearAddMarkers(); }

  function openAdd() {
    if (!$('addPanel').hidden) return closeAdd();   // 추가 버튼을 다시 누르면 닫힘
    const owner = S.role === 'owner';
    closeFilter(); setView('map'); hideInstallBar();
    $('addPanel').innerHTML = `<div class="ap-head"><b>${owner ? '맛집 추가' : '맛집 건의'}</b><button id="apX" type="button" aria-label="닫기">✕</button></div>
      <div class="ap-in"><input id="adIn" type="search" enterkeyhint="search" autocomplete="off" placeholder="식당 이름 또는 카카오맵 링크"><button id="adFind" class="icon" aria-label="찾기">🔍</button></div>
      <div id="adRes"><div class="sub ap-hint">식당 이름이나 카카오맵 공유 링크로 찾으세요. 후보가 지도에 번호로 표시되고, 가 본 곳이 맞으면 <b>${owner ? '추가' : '건의'}</b>를 누르면 됩니다.</div></div>
      ${owner ? '' : '<div class="ap-sec"><b>내 건의 현황</b><div id="mySg" class="sub">불러오는 중…</div></div>'}`;
    $('addPanel').hidden = false;
    $('apX').onclick = closeAdd;
    const find = async () => {
      const t = $('adIn').value.trim(); if (!t) return;
      $('adIn').blur();
      $('adRes').innerHTML = '<div class="sub ap-hint">찾는 중…</div>';
      try {
        let docs;
        if (/https?:\/\//.test(t)) { const r = await api('resolveLink', { text: t.slice(0, 500) }); docs = r.docs; if (!docs.length) throw new Error('링크에서 식당을 찾지 못했습니다. 식당 이름으로 검색해 보세요.'); }
        else { const c = map.getCenter(); const r = await api('kakaoSearch', { q: t, x: (S.pos ? S.pos[1] : c.getLng()), y: (S.pos ? S.pos[0] : c.getLat()) }); docs = r.docs; }
        renderAddResults(docs);
      } catch (e) { $('adRes').innerHTML = `<div class="sub ap-hint">${esc(e.message)}</div>`; }
    };
    $('adFind').onclick = find;
    $('adIn').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); find(); } });
    setTimeout(() => $('adIn').focus(), 50);
    if (!owner) api('mySuggestions').then(r => {
      const el = $('mySg'); if (!el) return;
      el.innerHTML = r.list.length ? r.list.map(x => `<div class="rv">${esc(x.name)} <span class="badge">${esc(x.st)}</span> <span class="sub">${esc(x.dt)}</span></div>`).join('') : '아직 건의한 식당이 없습니다.';
    }).catch(() => {});
  }

  function renderAddResults(docs) {
    const owner = S.role === 'owner';
    clearAddMarkers();
    if (!docs.length) { $('adRes').innerHTML = '<div class="sub ap-hint">검색 결과가 없습니다. 지역명을 함께 입력해 보세요.</div>'; return; }
    addDocs = docs.slice(0, 10);
    $('adRes').innerHTML = addDocs.map((d, i) => {
      const exist = owner && S.places.find(p => p.k === d.id);
      const dd = S.pos ? fmtDist(dist(S.pos, [d.y, d.x])) : '';
      const cat = String(d.cat || '').split(' > ').pop();
      return `<div class="ad" data-row="${i}"><div class="ad-nm"><span class="num">${i + 1}</span><span>${esc(d.name)}</span></div>
        <div class="ad-sub">${esc(cat)}${dd ? ' · ' + dd : ''}</div><div class="ad-sub">${esc(d.addr)}</div>
        ${exist ? '<div class="ad-sub" style="color:var(--g);font-weight:700">✔ 이미 등록됨</div>' : ''}
        <div class="ad-btns"><a href="https://place.map.kakao.com/${encodeURIComponent(d.id)}" target="_blank" rel="noopener">상세</a>
        ${exist ? `<button type="button" data-open="${esc(exist.id)}">열기</button>` : `<button type="button" class="pri" data-pick="${i}">${owner ? '추가' : '건의'}</button>`}</div></div>`;
    }).join('');
    addMarkers = addDocs.map((d, i) => {
      const ll = new kakao.maps.LatLng(d.y, d.x);
      const m = new kakao.maps.Marker({ position: ll, image: numImg(i + 1, false), title: d.name, zIndex: 30 });
      m.setMap(map);
      kakao.maps.event.addListener(m, 'click', () => focusAdd(i, false));
      return m;
    });
    $('adRes').scrollLeft = 0;
    focusAdd(0, true);   // 1번 후보 주변 근접 지도 (다른 후보는 핀으로 남김)
  }
  // 후보를 고르면 지도 확대 + 핀 강조 (목록·카드에 가리지 않는 곳에 오도록)
  function focusAdd(i, move, fromScroll) {
    if (fromScroll && i === addCur) return;
    const hl = (k, on) => { const mk = addMarkers[k]; if (!mk || !mk.setImage) return; mk.setImage(numImg(k + 1, on)); mk.setZIndex(on ? 40 : 30); };
    if (addCur >= 0) hl(addCur, false);
    addCur = i;
    if (!addMarkers[i]) return;
    hl(i, true);
    if (move !== false) {
      map.setLevel(3);
      map.setCenter(new kakao.maps.LatLng(addDocs[i].y, addDocs[i].x));
      const pd = panelPad();
      if (map.panBy && (pd.l || pd.b)) map.panBy(-Math.round(pd.l / 2), Math.round(pd.b / 2));   // 목록·카드에 가리지 않게
    }
    document.querySelectorAll('#adRes .ad').forEach(x => x.classList.toggle('on', +x.dataset.row === i));
    const row = document.querySelector(`#adRes .ad[data-row="${i}"]`);
    if (row && !fromScroll) {
      if (isPhone()) { const box = $('adRes'); box.scrollTo({ left: row.offsetLeft - (box.clientWidth - row.offsetWidth) / 2, behavior: 'smooth' }); }
      else row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  function pickDoc(d) {
    const owner = S.role === 'owner';
    openSheet(`<div class="sh-name">${esc(d.name)}</div><div class="sub">${esc(d.cat)}</div><div class="sub">${esc(d.addr)}</div>
      ${owner ? `<div class="fld"><label>선호도</label>${prefSeg('npPf', '찜한 곳')}</div>
        <div class="two"><div class="fld"><label>검증 메뉴 1</label><input type="text" id="npV1" list="menuList"></div>
        <div class="fld"><label>검증 메뉴 2</label><input type="text" id="npV2" list="menuList"></div></div>
        ${menuDatalist()}
        <div class="fld"><label>메모</label><textarea id="npMemo" maxlength="200"></textarea></div>
        <label class="toggle"><input type="checkbox" id="npPub"> 친구에게 공개</label>`
      : `<div class="fld"><label>추천 이유 (한줄평으로 함께 등록됩니다)</label><textarea id="sgR" maxlength="100" placeholder="예: 들기름막국수가 일품"></textarea></div>`}
      <button class="btn primary" id="npSave" style="width:100%;margin-top:10px">${owner ? '추가' : '건의 보내기'}</button>`);
    let pf = '찜한 곳';
    if (owner) bindPrefSeg('npPf', v => { pf = v; });
    $('npSave').onclick = async () => {
      $('npSave').disabled = true;
      try {
        if (owner) {
          const v1 = $('npV1').value.trim(), v2 = $('npV2').value.trim();
          if ((v1 || v2) && (pf === '찜한 곳' || pf === '우선방문')) pf = '검증완료';
          const r = await api('addPlace', { doc: d, extra: { pf, v1, v2, memo: $('npMemo').value.trim(), pub: $('npPub').checked } });
          if (r.dup) { toast('이미 등록된 식당입니다'); return openPlace(S.byId[r.id]); }
          addLocal(r.place); closeAdd(); toast('추가했습니다'); openPlace(S.byId[r.place.id]);
        } else {
          const r = await api('suggest', { doc: d, reason: $('sgR').value.trim() });
          toast(r.msg, 3000); closeAdd(); closeSheet();
        }
      } catch (e) { toast(e.message, 3500); $('npSave').disabled = false; }
    };
  }

  function addLocal(np) {
    S.places.push(indexPlace(np)); S.byId[np.id] = np;
    saveCache();
    applyFilters();
  }

  // ---------- 건의함 (본인) ----------
  async function openInbox() {
    openSheet('<div class="sh-name">건의함</div><div id="ibList" class="sub">불러오는 중…</div>');
    try {
      const r = await api('suggestions');
      setInbox(r.list.length);
      $('ibList').innerHTML = r.list.length ? r.list.map(x => `<div class="res">
        <div class="nm">${esc(x.name)}${x.dup ? '<span class="badge b-g">이미 등록됨</span>' : ''}${x.del ? '<span class="badge b-w">예전에 삭제함</span>' : ''}</div>
        <div class="sub">${esc(x.who)} · ${esc(x.dt)}</div>
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

  // ---------- 앱 설치 안내 버튼 ----------
  // 카톡 등 앱 안의 브라우저 → [크롬으로 열기] / 크롬(미설치) → [앱 설치] / 아이폰 사파리 → [홈 화면에 추가 방법] / 설치된 앱 → 표시 안 함
  let installEvt = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; showInstallBar(); });
  window.addEventListener('appinstalled', () => { installEvt = null; hideInstallBar(); toast('호야맛집 앱을 설치했습니다. 홈 화면의 아이콘으로 열어 주세요', 4000); });

  function installHidden() { const t = store.get('mz_install_hide', 0); return t && Date.now() - t < 7 * 864e5; }   // ✕를 누르면 7일간 숨김
  function hideInstallBar() { const b = $('installBar'); if (b) b.hidden = true; document.body.classList.remove('has-ib'); }
  function showInstallBar() {
    const b = $('installBar'); if (!b || IS_STANDALONE() || installHidden()) return;
    let label = '', sub = '', act = null;
    if (IN_APP) {
      label = '🌐 크롬으로 열기'; sub = '앱으로 설치하려면 크롬에서 열어 주세요';
      act = openInChrome;
    } else if (installEvt) {
      label = '📲 호야맛집 앱 설치'; sub = '홈 화면에 아이콘이 생기고 앱처럼 열립니다';
      act = async () => { const ev = installEvt; installEvt = null; hideInstallBar(); ev.prompt(); try { await ev.userChoice; } catch (e) { /* 무시 */ } };
    } else if (IS_IOS) {
      label = '📲 홈 화면에 추가하는 방법'; sub = '사파리에서 공유 버튼 → 홈 화면에 추가';
      act = () => openSheet(`<div class="sh-name">📲 아이폰에 설치하기</div>
        <div class="note" style="line-height:1.8;font-size:15px">① <b>사파리</b>로 이 화면을 엽니다<br>② 아래쪽 <b>공유 버튼</b>(□↑)을 누릅니다<br>③ <b>홈 화면에 추가</b>를 누릅니다<br>④ 오른쪽 위 <b>추가</b>를 누릅니다</div>`);
    } else return;
    b.innerHTML = `<button type="button" class="ib-go"><b>${label}</b><span>${sub}</span></button><button type="button" class="ib-x" aria-label="닫기">✕</button>`;
    b.querySelector('.ib-go').onclick = act;
    b.querySelector('.ib-x').onclick = () => { store.set('mz_install_hide', Date.now()); hideInstallBar(); };
    b.hidden = false; document.body.classList.add('has-ib');   // 알림 문구가 버튼에 가리지 않게 위로
  }
  function openInChrome(url) {
    url = url || `${location.origin}${location.pathname}?k=${encodeURIComponent(S.key)}`;
    const u = new URL(url);
    if (IS_IOS) { location.href = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(url); return; }
    location.href = `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=https;package=com.android.chrome;end`;
    // 크롬으로 넘어가지 않으면 (카톡 버전에 따라 막힐 수 있음) 주소를 복사하고 안내
    setTimeout(() => {
      if (document.hidden) return;
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(
        () => toast('주소를 복사했습니다. 크롬을 열어 주소창에 붙여넣어 주세요', 5000),
        () => toast('오른쪽 위 ⋮ → 다른 브라우저로 열기를 눌러 주세요', 5000));
    }, 1500);
  }

  // ---------- 실행 (모든 설정·함수가 정의된 뒤에 시작해야 함) ----------
  restoreUI();
  start();
})();
