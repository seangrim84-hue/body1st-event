# 아키텍처 상세

## 왜 이런 구조인가

GitHub Pages는 정적 파일만 서빙한다 (서버 코드 실행 불가). 하지만 토스페이먼츠 결제 승인(confirm) API는 시크릿 키가 필요해서 브라우저에서 직접 호출하면 시크릿 키가 그대로 노출된다. 이 문제를 Supabase Edge Function(서버리스 함수)으로 해결한다 — 시크릿 키는 Edge Function 환경변수에만 존재하고, 브라우저는 Edge Function을 통해서만 결제를 승인한다.

또한 "본인 결제내역만 보기 / 관리자만 전체 보기" 같은 권한 분리는 프론트엔드 코드가 아니라 Postgres RLS(Row Level Security) 정책으로 강제한다. 프론트엔드 체크는 UX용이고, 실제 데이터 접근 통제는 DB 레벨에서 이루어진다.

## DB 스키마

```
profiles
  id          uuid PK, references auth.users(id) on delete cascade
  email       text
  created_at  timestamptz

courses
  id          uuid PK (gen_random_uuid())
  title       text
  description text
  price       integer          -- 원 단위
  is_active   boolean default true
  created_at  timestamptz

orders
  id           uuid PK (gen_random_uuid())
  user_id      uuid, references profiles(id) on delete cascade
  course_id    uuid, references courses(id)
  order_id     text unique     -- 토스 orderId (클라이언트가 생성: "order_" + crypto.randomUUID())
  amount       integer
  status       text default 'pending'   -- 'pending' | 'paid'
  payment_key  text
  method       text
  approved_at  timestamptz
  created_at   timestamptz
```

`orders.user_id`는 `auth.users`가 아니라 `public.profiles`를 참조한다. PostgREST(Supabase가 REST API를 자동 생성해주는 방식)는 FK가 있어야 `orders(...).select("..., profiles(email)")`처럼 조인 임베딩이 가능한데, `auth` 스키마는 API에 노출되지 않기 때문이다. `profiles.id`가 이미 `auth.users.id`를 1:1로 미러링하므로 이 우회가 성립한다.

### 트리거

`auth.users`에 새 행이 insert될 때(회원가입/관리자 계정 생성 모두 포함) `handle_new_user()` 트리거(SECURITY DEFINER)가 `profiles`에 자동으로 같은 id/email을 넣는다. 회원가입 시점에 이미 `profiles`가 만들어지므로, 주문을 생성하는 시점엔 항상 `profiles` 행이 존재한다.

### 관리자 판별

```sql
create function public.is_admin() returns boolean language sql stable as $$
  select coalesce(auth.jwt() ->> 'email', '') = 'admin@admin.com';
$$;
```

admin 계정이 요구사항상 `admin@admin.com` 하나로 고정돼 있어서, 별도 `is_admin` 컬럼 없이 로그인 이메일만으로 판별한다.

## RLS 정책

| 테이블 | 정책 | 내용 |
|---|---|---|
| `courses` | SELECT | 전체 공개 (`true`) |
| `profiles` | SELECT | `auth.uid() = id OR is_admin()` |
| `orders` | INSERT | `auth.uid() = user_id` (본인 명의 주문만 생성 가능) |
| `orders` | SELECT | `auth.uid() = user_id OR is_admin()` |

`orders`에는 **UPDATE 정책이 없다.** 즉 일반 사용자는 물론 관리자 계정도 클라이언트에서 직접 주문 상태를 바꿀 수 없다. 상태를 `paid`로 바꾸는 유일한 경로는 Edge Function이 `service_role` 키(RLS 우회)로 실행하는 업데이트뿐이다 — 이렇게 해야 사용자가 결제 없이 자기 주문을 "결제완료"로 조작하는 걸 원천 차단할 수 있다.

`mypage.html`은 RLS만 믿지 않고 쿼리에도 `.eq("user_id", user.id)`를 명시한다. RLS 정책상 관리자 계정은 전체 행을 볼 수 있는데, "내 결제내역" 페이지는 관리자로 로그인했을 때도 항상 "내 것만" 보여줘야 하기 때문이다 (전체 조회는 `admin.html`의 역할).

## 결제 흐름

```
[products.html]
  1. 로그인 사용자가 "구매하기" 클릭
  2. orders에 status='pending' 행 insert (order_id = "order_"+uuid)
  3. TossPayments SDK .requestPayment('카드', {amount, orderId, orderName, successUrl, failUrl})
     → 토스 결제창(테스트 모드)으로 이동, 실제 카드사 연동 없이 테스트 결제 진행

[성공 시] → payment-success.html?paymentKey=...&orderId=...&amount=...
  4. supabaseClient.functions.invoke("confirm-payment", { body: {paymentKey, orderId, amount} })
     (supabase-js가 현재 로그인 세션의 access token을 Authorization 헤더로 자동 첨부)

[confirm-payment Edge Function]
  5. Authorization 헤더의 사용자 토큰으로 RLS-scoped 클라이언트를 만들어 orders를 order_id로 조회
     → RLS 덕분에 본인 주문이 아니면 조회 자체가 안 됨 (404 처리)
  6. 조회된 order.amount와 요청받은 amount가 일치하는지 확인 (위변조 방지)
  7. 토스 결제승인 API 호출: POST https://api.tosspayments.com/v1/payments/confirm
     Authorization: Basic base64(TOSS_SECRET_KEY + ":")
     body: {paymentKey, orderId, amount}
  8. 승인 성공 시 service_role 클라이언트로 orders.status='paid' 업데이트
  9. { ok: true } 반환

[실패/취소 시] → payment-fail.html?message=...
  DB 변경 없음. 주문은 pending 상태로 남고(구매 권한에 영향 없음), 사용자는 다시 시도 가능.
```

### Edge Function: `confirm-payment`

- 경로: `supabase/functions/confirm-payment/index.ts`
- 요청: `POST`, `Authorization: Bearer <사용자 access token>`, body `{ orderId, paymentKey, amount }`
- 응답: `{ ok: true }` 또는 `{ error: "..." }`
- 환경변수 (Supabase가 자동 주입): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- 환경변수 (직접 설정 필요): `TOSS_SECRET_KEY`
  ```bash
  supabase secrets set TOSS_SECRET_KEY=test_sk_xxx --project-ref nqxncpwwcgyaanrehibs
  ```
- 배포:
  ```bash
  supabase functions deploy confirm-payment --project-ref nqxncpwwcgyaanrehibs --no-verify-jwt
  ```
  (`--no-verify-jwt`인 이유: 함수 자체에서 사용자 토큰을 검증하고 RLS로 소유권을 확인하기 때문에, Supabase 플랫폼 레벨의 JWT 검증 게이트는 굳이 이중으로 두지 않음)

## 토스페이먼츠 연동에 필요한 것

- **클라이언트 키**(공개 가능): `products.html`의 `TOSS_CLIENT_KEY` 상수에 설정. 비어있으면 구매 버튼이 자동으로 비활성화된다.
- **시크릿 키**(비공개): 위 `supabase secrets set` 명령으로 Edge Function에만 설정.
- 두 키는 토스페이먼츠 개발자센터(https://developers.tosspayments.com) 무료 가입 후 "테스트 키"로 바로 발급 가능 (사업자 계약 불필요, 실서비스 전환 시에만 계약 필요).

## Supabase 프로젝트 정보

- ref: `nqxncpwwcgyaanrehibs`
- 리전: `ap-northeast-2` (서울)
- 마이그레이션: `supabase/migrations/0001_init.sql`, `0002_orders_user_fk_profiles.sql`
