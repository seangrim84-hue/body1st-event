# BODY1ST 온라인 교육 판매 사이트

## 개요

BODY1ST 교육 과정을 온라인으로 판매하는 사이트. 회원가입/로그인, 강좌 조회 및 결제(토스페이먼츠 테스트 모드), 내 결제내역, 관리자 전체 결제내역 조회 기능을 제공한다.

## 기술 스택

- **프론트엔드**: 빌드 과정 없는 순수 HTML/CSS/JS. `supabase-js`는 CDN(`@supabase/supabase-js@2`)으로 로드.
- **호스팅**: GitHub Pages (저장소 `seangrim84-hue/body1st-event`, `main` 브랜치 push 시 자동 배포)
- **백엔드**: Supabase — Auth, Postgres(RLS), Edge Function 1개 (`confirm-payment`)
- **결제**: 토스페이먼츠 일반결제(테스트 모드)

배포 URL: https://seangrim84-hue.github.io/body1st-event/

## 페이지 구성

| 파일 | 설명 |
|---|---|
| `index.html` | 이벤트 랜딩 페이지 (교육대기신청) |
| `signup.html` / `login.html` | 회원가입 / 로그인 |
| `products.html` | 강좌 목록 조회 + 구매(결제) 시작 |
| `payment-success.html` | 토스 결제 성공 리다이렉트 → 결제 승인 처리 |
| `payment-fail.html` | 토스 결제 실패/취소 리다이렉트 |
| `mypage.html` | 로그인한 사용자 본인의 결제내역 |
| `admin.html` | 관리자(`admin@admin.com`) 전용, 전체 회원 결제내역 |
| `app.js` | 공통 Supabase 클라이언트 초기화 + 상단 네비게이션 렌더링 |
| `site.css` | 상품/결제/마이페이지/관리자 페이지 공통 스타일 |

세부 아키텍처(DB 스키마, RLS, 결제 흐름, Edge Function 스펙)는 [ARCH.md](./ARCH.md) 참고.

## 배포 방법

이 폴더(`vibecoding_web`)가 곧 저장소다.

```bash
git add <변경 파일>
git commit -m "..."
git push origin main
```

push 후 GitHub Pages가 자동으로 새 버전을 반영한다 (보통 30초~1분 소요).

## Supabase

- 프로젝트: `body1st-event` (ref: `nqxncpwwcgyaanrehibs`, 서울 리전)
- CLI 로그인은 이미 돼 있는 상태 (`supabase login`으로 토큰 저장됨)
- DB 마이그레이션 SQL은 `supabase/migrations/`에 있고, Supabase Management API(`POST /v1/projects/{ref}/database/query`)로 직접 실행한다 (`supabase db push`는 CLI 이슈로 이 프로젝트에서 링크가 완전히 되지 않아 대안으로 사용 중)
- Edge Function 배포: `supabase functions deploy confirm-payment --project-ref nqxncpwwcgyaanrehibs --no-verify-jwt`

## 비밀키 보관 위치

- **토스페이먼츠 시크릿 키**: Supabase Edge Function 환경변수(`TOSS_SECRET_KEY`)로만 저장. 클라이언트 코드에는 절대 포함하지 않는다.
- **토스페이먼츠 클라이언트 키**: `products.html`의 `TOSS_CLIENT_KEY` 상수. 공개돼도 되는 값이라 프론트엔드에 그대로 둔다. (아직 미설정 — 설정 전까지 구매 버튼은 비활성 상태)
- **Supabase anon key**: `app.js`, `login.html`, `signup.html`에 하드코딩. RLS로 보호되므로 공개돼도 안전하다.
- **Supabase service_role key**: Edge Function 내부에서만 사용 (`SUPABASE_SERVICE_ROLE_KEY` 환경변수, Supabase가 자동 주입).

## 관리자 계정

- 이메일: `admin@admin.com`
- 이 계정으로 로그인하면 `admin.html`에서 전체 회원의 결제내역을 볼 수 있다.
- 관리자 판별은 DB의 `is_admin()` SQL 함수가 로그인 이메일이 `admin@admin.com`인지로 판단한다 (RLS 레벨에서도 강제됨).
