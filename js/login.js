// js/login.js

document.addEventListener("DOMContentLoaded", () => {
  const loginForm = document.getElementById("loginForm");
  const usernameInput = document.getElementById("username");
  const passwordInput = document.getElementById("password");
  const loginError = document.getElementById("loginError");
  const loginButton = document.getElementById("loginBtn");

  if (window.LokasightAuth?.getSession()) {
    window.location.replace("dashboard.html");
    return;
  }

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginError.classList.add("hidden");
    loginError.textContent = "";

    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (loginButton) {
      loginButton.disabled = true;
      loginButton.textContent = "Memeriksa...";
    }

    try {
      const result = await window.LokasightAuth.login(username, password);

      if (result.ok) {
        window.location.href = "dashboard.html";
        return;
      }

      loginError.textContent =
        result.reason === "locked"
          ? `Terlalu banyak percobaan. Coba lagi ${result.retryAfterSeconds} detik.`
          : "Username atau password salah";
      loginError.classList.remove("hidden");
    } catch {
      loginError.textContent = "Login lokal tidak tersedia di browser ini";
      loginError.classList.remove("hidden");
    } finally {
      if (loginButton) {
        loginButton.disabled = false;
        loginButton.textContent = "Login";
      }
    }
  });
});
