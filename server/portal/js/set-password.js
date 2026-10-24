function showMsg(text, isError) {
  const box = document.getElementById('msgBox');
  box.textContent = text;
  box.className = 'msg show' + (isError ? ' error' : ' ok');
}

function revealPage() {
  const gate = document.getElementById('authGate');
  if (!gate) return;
  gate.classList.add('gate-hide');
  setTimeout(() => gate.remove(), 300);
}

// فقط کسی که همین الان با رمزِ پیش‌فرض وارد شده باید این صفحه رو ببینه
async function guard() {
  try {
    const data = await apiGet('/me');
    if (!data.must_change) { window.location.replace('/portal/index.html'); return; }
    if (data.customer?.name) {
      document.getElementById('subText').textContent = `${data.customer.name} عزیز، این بارِ اوّلیه که وارد می‌شی. قبل از دیدنِ پروفایلت، یه رمزِ شخصی انتخاب کن تا از این به بعد با همون وارد بشی.`;
    }
    revealPage();
    document.getElementById('newPassword').focus();
  } catch (e) {
    window.location.replace('/portal/login.html');
  }
}

async function save(e) {
  e.preventDefault();
  const password = document.getElementById('newPassword').value;
  const password_confirm = document.getElementById('newPassword2').value;
  if (password.trim().length < 6) { showMsg('رمز باید حداقل ۶ کاراکتر باشه.', true); return; }
  if (password !== password_confirm) { showMsg('رمز و تکرارش یکی نیستن.', true); return; }
  const btn = document.getElementById('saveBtn');
  btn.disabled = true;
  try {
    await apiPost('/set-password', { password, password_confirm });
    window.location.replace('/portal/index.html');
  } catch (err) {
    if (err.status === 401) { window.location.replace('/portal/login.html'); return; }
    showMsg(err.message, true);
    btn.disabled = false;
  }
}

document.getElementById('setPasswordForm').addEventListener('submit', save);
document.getElementById('cancelBtn').addEventListener('click', async () => {
  try { await apiPost('/logout', {}); } catch (e) {}
  window.location.replace('/portal/login.html');
});

guard();
