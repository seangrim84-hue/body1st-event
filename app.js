const SUPABASE_URL = "https://nqxncpwwcgyaanrehibs.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xeG5jcHd3Y2d5YWFucmVoaWJzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYwOTYyNjEsImV4cCI6MjEwMTY3MjI2MX0.Xczq_wIwH5seetFo0LdbPLFXo5zUlII2Ij3Hej8p91E";
const ADMIN_EMAIL = "admin@admin.com";

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function formatWon(amount) {
  return amount.toLocaleString("ko-KR") + "원";
}

function formatDate(isoString) {
  const d = new Date(isoString);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

// Renders the shared top nav into #navLinks based on current session.
// Pass extra links (name/href pairs) to show while logged in, e.g. mypage/admin.
async function renderNav(extraLinksWhenLoggedIn) {
  const el = document.getElementById("navLinks");
  if (!el) return null;

  const { data } = await supabaseClient.auth.getSession();
  const user = data.session ? data.session.user : null;

  const links = [];
  links.push('<a href="products.html">강좌 보기</a>');
  if (user) {
    (extraLinksWhenLoggedIn || []).forEach((l) => {
      links.push(`<a href="${l.href}">${l.name}</a>`);
    });
    if (user.email === ADMIN_EMAIL) {
      links.push('<a href="admin.html">관리자</a>');
    }
    links.push('<button class="btn btn-outline btn-sm" id="navLogoutBtn">로그아웃</button>');
  } else {
    links.push('<a class="btn btn-primary btn-sm" href="login.html">로그인</a>');
  }
  el.innerHTML = links.join("");

  const logoutBtn = document.getElementById("navLogoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      await supabaseClient.auth.signOut();
      window.location.href = "login.html";
    });
  }

  return user;
}
