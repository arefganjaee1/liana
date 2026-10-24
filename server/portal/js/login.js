function showMsg(text, isError) {
  const box = document.getElementById('msgBox');
  box.textContent = text;
  box.className = 'msg show' + (isError ? ' error' : ' ok');
}
function hideMsg() {
  document.getElementById('msgBox').className = 'msg';
}

async function login(e) {
  e.preventDefault();
  const phone = document.getElementById('phoneInput').value.trim();
  const password = document.getElementById('passwordInput').value;
  if (!phone) { showMsg('شماره رو وارد کن', true); return; }
  if (!password) { showMsg('رمز رو وارد کن', true); return; }
  const btn = document.getElementById('loginBtn');
  btn.disabled = true;
  hideMsg();
  try {
    const res = await apiPost('/login', { phone, password });
    window.location.href = res.must_change ? '/portal/set-password.html' : '/portal/index.html';
  } catch (err) {
    showMsg(err.message, true);
    btn.disabled = false;
  }
}

document.getElementById('loginForm').addEventListener('submit', login);
