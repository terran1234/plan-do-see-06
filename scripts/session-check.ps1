# 카드 3 증거: 같은 주소·같은 방식의 요청을 "로그인 상태"에서 한 번, "로그아웃한 뒤"에 한 번 보내 두 응답을 나란히 기록한다.
#
# 실행: powershell -ExecutionPolicy Bypass -File scripts\session-check.ps1
#  - 비밀번호와 키는 실행할 때 직접 입력한다 (화면에 보이지 않고, 파일에도 저장되지 않는다).
#  - 출력에는 토큰·세션 값을 앞 5글자만 보이고 "…생략"으로 가려서 적는다.
#  - 결과는 scripts\session-check-output.txt 에도 저장된다 (가려진 값만 들어 있다).
param(
  [string]$Email       = 'plan1@naver.com',
  [string]$App         = 'https://plan-do-see-06.vercel.app',
  [string]$SupabaseUrl = 'https://fdellxhmuhlgkbaeenbg.supabase.co',
  [string]$Out         = (Join-Path $PSScriptRoot 'session-check-output.txt')
)
$ErrorActionPreference = 'Stop'
$log = New-Object System.Collections.Generic.List[string]
function Say($t) { Write-Host $t; $log.Add([string]$t) }
function Mask($s) { if (-not $s) { return '(없음)' }; if ($s.Length -le 5) { return '(생략)' }; return $s.Substring(0, 5) + '…생략' }
function Plain([System.Security.SecureString]$s) {
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}
function B64Url([string]$s) { [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($s)).TrimEnd('=').Replace('+', '-').Replace('/', '_') }
function JwtClaims([string]$jwt) {
  $p = $jwt.Split('.')[1].Replace('-', '+').Replace('_', '/')
  while ($p.Length % 4) { $p += '=' }
  [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p)) | ConvertFrom-Json
}
function Call([string]$method, [string]$url, $headers, [string]$body) {
  $p = @{ Method = $method; Uri = $url; Headers = $headers; UseBasicParsing = $true }
  if ($body) { $p.Body = $body; $p.ContentType = 'application/json' }
  try { $r = Invoke-WebRequest @p; return @{ status = [int]$r.StatusCode; text = [string]$r.Content } }
  catch {
    $resp = $_.Exception.Response
    if (-not $resp) { throw }
    $text = (New-Object IO.StreamReader($resp.GetResponseStream())).ReadToEnd()
    return @{ status = [int]$resp.StatusCode; text = $text }
  }
}

# ── 입력 (직접 입력, 화면에 안 보임) ──
$key = $env:SUPABASE_ANON_KEY
if (-not $key) { $key = Plain (Read-Host 'Supabase publishable(anon) 키를 붙여 넣으세요' -AsSecureString) }
$pw = Plain (Read-Host "$Email 의 비밀번호" -AsSecureString)

Say "=== 카드 3 세션 확인 ($(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')) ==="
Say "계정: $Email   앱: $App"
Say ''

# ── 1. 로그인 → 세션 받기 ──
$login = Call 'POST' "$SupabaseUrl/auth/v1/token?grant_type=password" @{ apikey = $key } (@{ email = $Email; password = $pw } | ConvertTo-Json -Compress)
$pw = $null
if ($login.status -ne 200) { Say "로그인 실패: 상태 $($login.status)"; $log | Set-Content -Encoding UTF8 $Out; exit 1 }
$sess = $login.text | ConvertFrom-Json
$claims = JwtClaims $sess.access_token
$issued = [DateTimeOffset]::FromUnixTimeSeconds($claims.iat).ToLocalTime()
$expires = [DateTimeOffset]::FromUnixTimeSeconds($claims.exp).ToLocalTime()
Say '[1] 로그인 성공 → 서버가 세션을 만들어 토큰을 내줌'
Say "    access_token  : $(Mask $sess.access_token)   (서명된 토큰, JWT)"
Say "    refresh_token : $(Mask $sess.refresh_token)   (새 토큰을 받는 데만 쓰는 값)"
Say "    session_id    : $(Mask $claims.session_id)   (서버 DB의 세션 한 줄과 이어짐)"
Say "    발급 시각     : $($issued.ToString('yyyy-MM-dd HH:mm:ss'))"
Say "    만료 시각     : $($expires.ToString('yyyy-MM-dd HH:mm:ss'))   → 발급 후 $($claims.exp - $claims.iat)초($([math]::Round(($claims.exp - $claims.iat) / 60))분)"
Say ''

# ── 2. 앱이 쿠키에 담는 모양 그대로 만들기 (@supabase/ssr: 이름 sb-<프로젝트>-auth-token, 값 base64- + base64url(JSON)) ──
$ref = ([Uri]$SupabaseUrl).Host.Split('.')[0]
$cookieName = "sb-$ref-auth-token"
$sessionJson = @{ access_token = $sess.access_token; token_type = $sess.token_type; expires_in = $sess.expires_in; expires_at = $sess.expires_at; refresh_token = $sess.refresh_token; user = $sess.user } | ConvertTo-Json -Compress -Depth 10
$val = 'base64-' + (B64Url $sessionJson)
if ($val.Length -le 3180) { $cookie = "$cookieName=$val" }
else { $parts = for ($i = 0; $i * 3180 -lt $val.Length; $i++) { "$cookieName.$i=" + $val.Substring($i * 3180, [math]::Min(3180, $val.Length - $i * 3180)) }; $cookie = $parts -join '; ' }

function AppRequest([string]$label) {
  $hdr = [IO.Path]::GetTempFileName(); $body = [IO.Path]::GetTempFileName()
  $curlArgs = @('-s', '-o', $body, '-D', $hdr, '-w', '%{http_code}', '-H', "Cookie: $cookie", "$App/")
  $code = & curl.exe @curlArgs
  $h = Get-Content $hdr -Raw; $b = Get-Content $body -Raw -Encoding UTF8
  $loc = if ($h -match '(?im)^location:\s*(\S+)') { $Matches[1] } else { '(없음)' }
  Remove-Item $hdr, $body -ErrorAction SilentlyContinue
  return @{ code = $code; location = $loc; hasEmail = ($b -and $b.Contains($Email)); hasToken = ($h + $b).Contains($sess.access_token) }
}

# ── 3. 로그인 상태에서 요청 ──
Say '[2] 요청 A (로그인 상태)'
Say "    GET $App/"
Say "    Cookie: $cookieName=$(Mask $val)   (쿠키 값은 가림. 주소에는 토큰이 없음)"
$a = AppRequest 'A'
Say "    → 응답 상태: $($a.code)   내 이메일이 화면에 있음: $($a.hasEmail)   응답에 토큰 원문 있음: $($a.hasToken)"
Say ''

# ── 4. 로그아웃 (앱의 로그아웃 버튼이 하는 일과 같은 호출: 서버에서 세션을 끊는다) ──
$lo = Call 'POST' "$SupabaseUrl/auth/v1/logout" @{ apikey = $key; Authorization = "Bearer $($sess.access_token)" } ''
Say "[3] 로그아웃 → 서버에서 세션 삭제   (응답 상태: $($lo.status))"
Say ''

# ── 5. 같은 요청을 한 번 더 (주소·방식·쿠키 값 모두 [2]와 똑같음, 달라진 것은 로그아웃뿐) ──
Say '[4] 요청 B (로그아웃 뒤, [2]와 같은 주소·같은 방식·같은 쿠키 값)'
Say "    GET $App/"
Say "    Cookie: $cookieName=$(Mask $val)   (A와 같은 값)"
$b2 = AppRequest 'B'
Say "    → 응답 상태: $($b2.code)   이동할 주소: $($b2.location)   내 이메일이 화면에 있음: $($b2.hasEmail)"
Say ''

# ── 6. 서버에서도 끊겼는지: 만료 시각 전인데도 거절되는가 ──
$nowLocal = Get-Date
Say "[5] 만료 시각($($expires.ToString('HH:mm:ss'))) 전인데도 옛 토큰이 통하는지 (지금 $($nowLocal.ToString('HH:mm:ss')))"
$u = Call 'GET' "$SupabaseUrl/auth/v1/user" @{ apikey = $key; Authorization = "Bearer $($sess.access_token)" } ''
$uErr = try { ($u.text | ConvertFrom-Json).error_code } catch { '' }
Say "    옛 access_token 으로 '나는 누구인가' 요청 → 상태 $($u.status)  오류 코드: $uErr"
$r = Call 'POST' "$SupabaseUrl/auth/v1/token?grant_type=refresh_token" @{ apikey = $key } (@{ refresh_token = $sess.refresh_token } | ConvertTo-Json -Compress)
$rErr = try { ($r.text | ConvertFrom-Json).error_code } catch { '' }
Say "    옛 refresh_token 으로 새 토큰 요청        → 상태 $($r.status)  오류 코드: $rErr"
Say ''

# ── 요약 ──
$pass = ($a.code -eq '200') -and ($b2.code -eq '307') -and ($u.status -ge 400) -and ($r.status -ge 400)
Say "요약: A=$($a.code) / B=$($b2.code) / 옛 토큰=$($u.status) / 옛 refresh=$($r.status)   → 로그아웃 뒤 이전 값이 통하지 않음: $pass"

$log | Set-Content -Encoding UTF8 $Out
Write-Host "`n저장됨: $Out  (가려진 값만 들어 있어요)"
$key = $null; $sess = $null; $val = $null; $cookie = $null
