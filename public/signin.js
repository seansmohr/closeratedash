(() => {
  const msgs = {
    domain: 'That account isn’t on jmohrins.com. Sign in with your work Google account.',
    expired: 'The sign-in link expired. Try again.',
    failed: 'Google sign-in didn’t finish. Try again.',
  };
  const code = new URLSearchParams(location.search).get('error');
  const el = document.getElementById('err');
  if (code && msgs[code]) { el.textContent = msgs[code]; el.hidden = false; }
})();
