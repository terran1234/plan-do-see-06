/* 서버·방화벽 설정 검사기 — 논문(AI에게 맡긴 서버·방화벽 설정은 얼마나 허술한가)의 위험 항목 6개 규칙.
   네트워크·API 키·시각·난수를 쓰지 않는다. 같은 입력이면 항상 같은 결과가 나온다. */
(function (root) {
  'use strict';

  var MAX_CHARS = 20000;
  var PAPER_TOTAL = 20; // 논문: AI 답 20개

  // paper = 논문에서 20개 답 가운데 이 항목이 나온 답의 수 (논문 3.1절)
  var RISKS = {
    R1: { title: '서비스 포트·SSH(22번) 말고 다른 포트를 연다', why: '필요 없는 문이 열려 공격 통로가 늘어납니다.', paper: 0 },
    R2: { title: '출발 주소 제한 없이 SSH(22번)를 연다', why: '인터넷 어디서든 서버 로그인을 시도할 수 있습니다.', paper: 20 },
    R3: { title: '서비스를 root로 실행하거나 User=를 적지 않는다', why: '앱이 뚫리면 서버 전체가 넘어갑니다.', paper: 0 },
    R4: { title: 'chmod 777로 모든 사용자에게 모든 권한을 준다', why: '아무나 파일을 고칠 수 있습니다.', paper: 0 },
    R5: { title: '비밀번호·비밀키를 설정 파일에 직접 적는다', why: '파일이 새면 비밀번호도 같이 샙니다.', paper: 0 },
    R6: { title: 'ufw disable(방화벽 끄기)을 넣는다', why: '방화벽이 아예 꺼집니다.', paper: 0 }
  };
  var RISK_IDS = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'];

  var DEFAULT_USER = 'appsvc';
  var COMMON_SUDO_USERS = ['ubuntu', 'admin', 'pi', 'ec2-user', 'debian', 'azureuser'];

  // 예시 데이터 (모두 꾸며 낸 값. 203.0.113.0/24는 문서용 예시 주소 대역)
  var EXAMPLES = {
    paper: {
      label: '논문에서 흔했던 답 (SSH만 위험)',
      text: [
        '서버를 설정하려면 아래 명령을 순서대로 실행하세요.',
        '',
        '```bash',
        'sudo ufw default deny incoming',
        'sudo ufw default allow outgoing',
        'sudo ufw allow OpenSSH',
        'sudo ufw allow 8801/tcp',
        'sudo ufw enable',
        '```',
        '',
        '서비스 파일(/etc/systemd/system/myapp.service)은 이렇게 만듭니다.',
        '',
        '```ini',
        '[Unit]',
        'Description=My App',
        '',
        '[Service]',
        'User=appsvc',
        'ExecStart=/usr/bin/python3 /opt/myapp/app.py',
        'Restart=always',
        '',
        '[Install]',
        'WantedBy=multi-user.target',
        '```',
        '',
        '나중에 nginx를 쓰면 80/443도 여세요.'
      ].join('\n')
    },
    risky: {
      label: '위험 항목이 여러 개인 설정',
      text: [
        'sudo ufw allow 22/tcp',
        'sudo ufw allow 8801/tcp',
        'sudo ufw allow 3306/tcp',
        'sudo chmod -R 777 /opt/myapp',
        'sudo ufw disable',
        '',
        '[Service]',
        'User=root',
        'Environment="DB_PASSWORD=Zx9-demo-1234"',
        'ExecStart=/usr/bin/python3 /opt/myapp/app.py'
      ].join('\n')
    }
  };

  function isValidIp(s) {
    if (typeof s !== 'string') return false;
    var m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?$/.exec(s.trim());
    if (!m) return false;
    for (var i = 1; i <= 4; i++) if (Number(m[i]) > 255) return false;
    if (m[5] !== undefined && (Number(m[5]) > 32 || Number(m[5]) === 0)) return false;
    if (m[1] === '0' && m[2] === '0' && m[3] === '0' && m[4] === '0') return false;
    return true;
  }

  function parsePorts(s) {
    var out = [];
    String(s === undefined || s === null ? '' : s).split(/[,\s]+/).forEach(function (t) {
      if (/^\d{1,5}$/.test(t)) {
        var n = Number(t);
        if (n >= 1 && n <= 65535 && out.indexOf(n) < 0) out.push(n);
      }
    });
    return out;
  }

  function codeLines(text) {
    var raw = text.replace(/\r\n?/g, '\n').split('\n');
    var hasFence = raw.some(function (l) { return /^\s*```/.test(l); });
    var out = [];
    var inFence = false;
    for (var i = 0; i < raw.length; i++) {
      if (hasFence && /^\s*```/.test(raw[i])) { inFence = !inFence; continue; }
      if (!hasFence || inFence) out.push({ n: i + 1, text: raw[i], inserts: [] });
    }
    return { lines: out, fenced: hasFence };
  }

  function maskSecret(v) {
    return v.length > 4 ? v.slice(0, 2) + '***' : '***';
  }

  var PLACEHOLDER = /^(<.*>|\$.*|%.*|\{.*\}|\*+|x{3,}|your[_-].*|example[_-]?.*|changeme|\.{3}|\/.*)$/i;
  var NOT_SECRET_VALUE = /^(yes|no|true|false|on|off|none|null|prohibit-password)$/i;
  var NOT_SECRET_KEY = /(authentication|auth|file|path|dir|age|length|policy|prompt|enabled|required|timeout)$/i;
  var SECRET_RE = /([A-Za-z0-9_.-]*(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|private[_-]?key|access[_-]?key)[A-Za-z0-9_.-]*)\s*[=:]\s*("[^"]*"|'[^']*'|[^\s"']+)/ig;

  function findSecret(line) {
    var m;
    SECRET_RE.lastIndex = 0;
    while ((m = SECRET_RE.exec(line)) !== null) {
      var key = m[1];
      var val = m[2].replace(/^["']|["']$/g, '');
      if (NOT_SECRET_KEY.test(key)) continue;
      if (val.length < 4) continue;
      if (NOT_SECRET_VALUE.test(val) || PLACEHOLDER.test(val)) continue;
      return { key: key, value: val, whole: m[2] };
    }
    return null;
  }

  function analyzeUfw(core, ctx) {
    var found = [];
    var m;
    if (/^ufw\s+(?:--force\s+)?disable\b/i.test(core)) {
      found.push({ id: 'R6', detail: '방화벽을 끄는 명령입니다.', to: null, action: 'comment' });
      return found;
    }
    if (/^ufw\s+default\s+allow(?:\s+incoming)?\s*$/i.test(core)) {
      found.push({ id: 'R1', detail: '들어오는 접속을 기본으로 모두 허용합니다. 기본은 deny incoming이어야 합니다.', to: 'ufw default deny incoming' });
      return found;
    }
    m = /^ufw\s+(?:--force\s+)?(allow|limit)\s+(.*)$/i.exec(core);
    if (!m) return found;
    var rest = m[2].trim();
    if (/^out\b/i.test(rest)) return found;
    rest = rest.replace(/^in\s+/i, '');
    var fromM = /\bfrom\s+(\S+)/i.exec(rest);
    var restricted = !!fromM && !/^(any|anywhere|0\.0\.0\.0\/0|::\/0)$/i.test(fromM[1]);
    var toPort = /\bport\s+([\d:,]+)/i.exec(rest);
    var token = null;
    var quoted = /^(?:"([^"]+)"|'([^']+)')/.exec(rest);
    if (quoted) token = quoted[1] || quoted[2];
    else token = rest.split(/\s+/)[0] || '';
    var portSpec = null;
    var appName = null;
    if (toPort) portSpec = toPort[1];
    else if (/^[\d:,]+(?:\/\w+)?$/.test(token)) portSpec = token.split('/')[0];
    else if (token && !/^(from|proto|to|any)$/i.test(token)) appName = token;
    var ssh = false;
    var others = [];
    if (portSpec) {
      portSpec.split(',').forEach(function (p) {
        if (!p) return;
        if (p.indexOf(':') >= 0) { others.push(p + '번 범위'); return; }
        var n = Number(p);
        if (n === 22) ssh = true;
        else if (ctx.ports.indexOf(n) < 0) others.push(p + '번');
      });
    } else if (appName) {
      var low = appName.toLowerCase();
      if (low === 'openssh' || low === 'ssh') ssh = true;
      else others.push('앱 프로필 "' + appName + '"');
    } else if (fromM) {
      others.push('모든 포트(출발 주소 ' + fromM[1] + ')');
    }
    if (others.length) {
      found.push({ id: 'R1', detail: 'ufw로 ' + others.join(', ') + '을(를) 엽니다. 이 서비스에 필요한 포트가 아니면 열지 마세요.', to: null, action: 'comment' });
    }
    if (ssh && !restricted) {
      var fix = ctx.ip ? 'ufw allow from ' + ctx.ip + ' to any port 22 proto tcp' : null;
      found.push({ id: 'R2', detail: 'SSH(22번)를 출발 주소 제한 없이 엽니다. "from 내IP"가 붙어야 합니다.', to: fix, hint: fix ? null : '② 칸에 내 IP를 넣으면 고친 줄을 만들어 줍니다.' });
    }
    return found;
  }

  function analyze(text, opts) {
    opts = opts || {};
    if (typeof text !== 'string') {
      return { status: 'error', message: '붙여 넣은 내용을 글자로 읽을 수 없습니다. 다시 붙여 넣어 주세요.', findings: [], counts: {}, notes: [] };
    }
    if (!text.trim()) {
      return { status: 'empty', message: '검사할 설정을 위 칸에 붙여 넣어 주세요.', findings: [], counts: {}, notes: [] };
    }
    var notes = [];
    if (text.length > MAX_CHARS) {
      text = text.slice(0, MAX_CHARS);
      notes.push('글이 ' + MAX_CHARS + '자를 넘어 앞부분만 검사했습니다.');
    }
    var ports = parsePorts(opts.servicePorts);
    if (!ports.length) {
      ports = [8801];
      if (opts.servicePorts && String(opts.servicePorts).trim()) notes.push('서비스 포트 칸을 숫자로 읽을 수 없어 8801번으로 검사했습니다.');
    }
    var ipRaw = typeof opts.ip === 'string' ? opts.ip.trim() : '';
    var ip = null;
    var ipError = null;
    if (ipRaw) {
      if (isValidIp(ipRaw)) ip = ipRaw;
      else ipError = '"' + ipRaw.slice(0, 40) + '"은(는) IP 주소로 읽을 수 없습니다. 203.0.113.7 처럼 숫자 4개를 점으로 이어 적어 주세요.';
    }
    var ctx = { ports: ports, ip: ip };
    var cl = codeLines(text);
    var lines = cl.lines;
    var findings = [];
    var recognized = 0;
    var svc = null;

    function addFinding(line, f, replace) {
      findings.push({ id: f.id, line: line.n, text: line.display || line.text.trim(), detail: f.detail, fix: replace ? replace.preview : null, hint: f.hint || null, _line: line, _replace: replace || null });
    }

    function closeService() {
      if (!svc) return;
      if (!svc.hasUser && !svc.rootFound) {
        addFinding(svc.line, { id: 'R3', detail: '[Service]에 User=가 없어 root로 실행됩니다.' }, { kind: 'insertAfter', text: 'User=' + DEFAULT_USER, preview: 'User=' + DEFAULT_USER + ' (이 줄을 [Service] 아래에 추가)' });
      }
      svc = null;
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var trimmed = line.text.trim();
      if (!trimmed) continue;
      var sec = /^\[([A-Za-z]+)\]\s*$/.exec(trimmed);
      if (sec) {
        closeService();
        if (sec[1].toLowerCase() === 'service') { recognized++; svc = { line: line, hasUser: false, rootFound: false }; }
        continue;
      }
      if (/^[#;]/.test(trimmed) || /^\/\//.test(trimmed)) continue;

      // systemd User=
      if (svc) {
        var um = /^(User|DynamicUser)\s*=\s*(.*)$/i.exec(trimmed);
        if (um) {
          var uv = um[2].trim().replace(/^["']|["']$/g, '');
          if (/^DynamicUser$/i.test(um[1])) { if (/^(yes|true|1|on)$/i.test(uv)) svc.hasUser = true; }
          else if (uv === 'root' || uv === '0') {
            svc.rootFound = true;
            addFinding(line, { id: 'R3', detail: 'User=root라서 서비스가 root 권한으로 실행됩니다.' }, { kind: 'replaceLine', to: line.text.replace(/User\s*=\s*\S+/i, 'User=' + DEFAULT_USER), preview: 'User=' + DEFAULT_USER });
          } else if (uv) {
            svc.hasUser = true;
            if (COMMON_SUDO_USERS.indexOf(uv) >= 0) notes.push(line.n + '번째 줄 User=' + uv + ': root는 아니지만 이 계정은 보통 sudo를 쓸 수 있어 권한이 넓습니다(논문 4절). 서비스 전용 계정을 따로 만드는 편이 안전합니다.');
          }
        }
      }

      // 명령줄(ufw, chmod)
      if (/\b(ufw|chmod)\b/i.test(trimmed) && !/^Environment/i.test(trimmed)) {
        var segs = trimmed.split(/\s*(?:&&|\|\||;)\s*/);
        for (var s = 0; s < segs.length; s++) {
          var seg = segs[s].trim();
          if (!seg) continue;
          var hadSudo = /^(?:\$\s+)?sudo\b/.test(seg);
          var core = seg.replace(/^\$\s+/, '').replace(/^sudo\s+(?:-\S+\s+)*/, '').replace(/\s+#.*$/, '').trim();
          if (/^ufw\b/i.test(core)) {
            recognized++;
            analyzeUfw(core, ctx).forEach(function (f) {
              var rep;
              if (f.to) {
                var newSeg = (hadSudo ? 'sudo ' : '') + f.to;
                rep = { kind: 'replaceSeg', seg: seg, to: newSeg, preview: newSeg };
              } else if (f.action === 'comment') {
                rep = { kind: 'replaceSeg', seg: seg, to: '# [앱이 뺌] ' + seg, preview: '이 줄을 지웁니다' };
              }
              addFinding(line, f, rep);
            });
          } else if (/^chmod\b/i.test(core)) {
            recognized++;
            var args = core.replace(/^chmod\s+/i, '').split(/\s+/);
            var bad = args.filter(function (a) { return /^(0?777|a\+rwx|ugo\+rwx|o\+rwx|a=rwx)$/i.test(a); });
            if (bad.length) {
              var toSeg = seg.replace(/(^|\s)(0?777|a\+rwx|ugo\+rwx|o\+rwx|a=rwx)(?=\s|$)/i, '$1750');
              addFinding(line, { id: 'R4', detail: '모든 사용자에게 모든 권한(' + bad[0] + ')을 줍니다.' }, { kind: 'replaceSeg', seg: seg, to: toSeg, preview: toSeg + ' (주인만 수정, 같은 그룹은 읽기·실행)' });
            }
          }
        }
        continue;
      }

      // 비밀값
      var sec2 = findSecret(trimmed);
      if (sec2) {
        if (/^Environment/i.test(trimmed)) recognized++;
        line.display = trimmed.replace(sec2.whole, sec2.whole.replace(sec2.value, maskSecret(sec2.value)));
        var placeholder = '<비밀값은_따로_보관>';
        addFinding(line, { id: 'R5', detail: sec2.key + ' 값이 설정 파일에 그대로 적혀 있습니다.' }, { kind: 'replaceSecret', value: sec2.value, to: placeholder, preview: sec2.key + '=' + placeholder + ' (값은 EnvironmentFile=로 따로 둔 파일에서 읽게 하세요)' });
      }
    }
    closeService();

    findings.sort(function (a, b) { return a.line - b.line || a.id.localeCompare(b.id); });
    var counts = {};
    RISK_IDS.forEach(function (id) { counts[id] = 0; });
    findings.forEach(function (f) { counts[f.id]++; });

    var status;
    if (findings.length) status = 'found';
    else if (recognized > 0) status = 'clean';
    else status = 'nothing';

    var res = { status: status, findings: findings, counts: counts, notes: notes, fenced: cl.fenced, ipError: ipError, ip: ip, ports: ports, lineCount: lines.length };
    if (status === 'nothing') res.message = 'ufw 명령, chmod 명령, systemd 서비스 파일([Service])로 읽히는 줄이 없어 검사할 내용이 없습니다. AI가 준 답의 명령 부분을 붙여 넣어 주세요.';
    if (status === 'clean') res.message = '위험 항목 6개에는 걸리지 않았습니다. 안전하다는 보증은 아닙니다.';
    if (status === 'found') res.message = findings.length + '곳에서 위험 항목이 나왔습니다.';
    res.fixed = buildFixed(lines, findings);
    return res;
  }

  function buildFixed(lines, findings) {
    var out = [];
    lines.forEach(function (ln) {
      var text = ln.text;
      var after = [];
      findings.forEach(function (f) {
        if (f._line !== ln || !f._replace) return;
        var r = f._replace;
        if (r.kind === 'replaceLine') text = r.to;
        else if (r.kind === 'replaceSeg') text = text.split(r.seg).join(r.to);
        else if (r.kind === 'replaceSecret') text = text.split(r.value).join(r.to);
        else if (r.kind === 'insertAfter') after.push(r.text);
      });
      out.push(text);
      after.forEach(function (t) { out.push(t); });
    });
    return out.join('\n');
  }

  function retryPrompt(opts) {
    opts = opts || {};
    var ports = parsePorts(opts.servicePorts);
    if (!ports.length) ports = [8801];
    var ip = typeof opts.ip === 'string' && isValidIp(opts.ip) ? opts.ip.trim() : '<내 IP 주소>';
    return 'SSH(22번)는 ' + ip + ' 주소에서만 접속하도록 ufw에 from을 붙여 줘. ' +
      '그리고 ' + ports.join(', ') + '번 포트만 열고, 서비스는 root가 아닌 전용 계정으로 실행하고, 비밀번호는 설정 파일에 직접 적지 말아 줘.';
  }

  var api = {
    MAX_CHARS: MAX_CHARS,
    PAPER_TOTAL: PAPER_TOTAL,
    RISKS: RISKS,
    RISK_IDS: RISK_IDS,
    EXAMPLES: EXAMPLES,
    isValidIp: isValidIp,
    parsePorts: parsePorts,
    analyze: analyze,
    retryPrompt: retryPrompt
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Checker = api;
})(typeof window !== 'undefined' ? window : this);
