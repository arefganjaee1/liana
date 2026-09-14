let currentPhone = '';

function showMsg(text, isError) {
  const box = document.getElementById('msgBox');
  box.textContent = text;
  box.className = 'msg show' + (isError ? ' error' : ' ok');
}
function hideMsg() {
  document.getElementById('msgBox').className = 'msg';
}

function goToCodeStep(phone) {
  currentPhone = phone;
  document.getElementById('stepPhone').hidden = true;
  document.getElementById('stepCode').hidden = false;
  document.getElementById('stepTitle').textContent = 'واردکردنِ کد';
  document.getElementById('stepSub').textContent = `کدِ ۵رقمی برایِ ${phone} پیامک شد.`;
  document.getElementById('codeInput').focus();
}

function goToPhoneStep() {
  currentPhone = '';
  document.getElementById('stepCode').hidden = true;
  document.getElementById('stepPhone').hidden = false;
  document.getElementById('stepTitle').textContent = 'ورود با شماره‌ی تلفن';
  document.getElementById('stepSub').textContent = 'همون شماره‌ای که موقعِ نوبت‌گیری دادی رو وارد کن تا کدِ ورود برات پیامک بشه.';
  hideMsg();
}

async function requestCode() {
  const phone = document.getElementById('phoneInput').value.trim();
  if (!phone) { showMsg('شماره رو وارد کن', true); return; }
  const btn = document.getElementById('sendCodeBtn');
  btn.disabled = true;
  hideMsg();
  try {
    const res = await apiPost('/request-otp', { phone });
    goToCodeStep(phone);
    if (res.dev_code) showMsg(`(حالتِ آزمایشی — پیامکِ واقعی ارسال نشد) کد: ${res.dev_code}`, false);
  } catch (e) {
    showMsg(e.message, true);
  } finally {
    btn.disabled = false;
  }
}

async function verifyCode() {
  const code = document.getElementById('codeInput').value.trim();
  if (!code) { showMsg('کد رو وارد کن', true); return; }
  const btn = document.getElementById('verifyBtn');
  btn.disabled = true;
  hideMsg();
  try {
    await apiPost('/verify-otp', { phone: currentPhone, code });
    window.location.href = '/portal/index.html';
  } catch (e) {
    showMsg(e.message, true);
  } finally {
    btn.disabled = false;
  }
}

document.getElementById('sendCodeBtn').addEventListener('click', requestCode);
document.getElementById('verifyBtn').addEventListener('click', verifyCode);
document.getElementById('backBtn').addEventListener('click', goToPhoneStep);
document.getElementById('resendBtn').addEventListener('click', requestCode);
document.getElementById('phoneInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') requestCode(); });
document.getElementById('codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') verifyCode(); });
