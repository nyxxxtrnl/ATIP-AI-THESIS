"use strict";

const loginForm = document.getElementById("loginForm");
const signupForm = document.getElementById("signupForm");
const professionalFields = document.getElementById("professionalFields");
const licenseDocument = document.getElementById("licenseDocument");
const licenseNumber = document.getElementById("licenseNumber");
const professionalName = document.getElementById("professionalName");
const verificationConsent = document.getElementById("verificationConsent");
const message = document.getElementById("message");
const statusView = document.getElementById("statusView");
const signupPassword = document.getElementById("signupPassword");
const confirmPassword = document.getElementById("confirmPassword");

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "application/pdf"];

function serverConnectionMessage() {
  if (window.location.protocol === "file:") {
    return "The ATIP server is not running. Start it with `npm start`, then open the sign-in page below.";
  }
  return "Cannot reach the ATIP server. Start it with `npm start`, then open http://127.0.0.1:3000/ (not a file:// page).";
}

async function requestJson(url, options) {
  if (window.location.protocol === "file:") {
    throw new Error(serverConnectionMessage());
  }

  let response;
  try {
    response = await fetch(url, options);
  } catch {
    throw new Error(serverConnectionMessage());
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("The ATIP server returned an invalid response. Restart it and try again.");
  }
  if (!response.ok) throw new Error(data.error || "The request failed.");
  return data;
}

function showMessage(text, isError = false) {
  message.textContent = text;
  message.hidden = false;
  message.classList.toggle("error", isError);
}

function clearMessage() {
  message.textContent = "";
  message.hidden = true;
  message.classList.remove("error");
}

function showFileStartupError() {
  showMessage(serverConnectionMessage(), true);
  const link = document.createElement("a");
  link.href = "http://127.0.0.1:3000/";
  link.textContent = "Open ATIP sign in";
  link.className = "server-link";
  message.append(document.createElement("br"), link);
}

async function openBackendFromFile() {
  const backendUrl = "http://127.0.0.1:3000/";
  try {
    await fetch(`${backendUrl}api/health`, {
      mode: "no-cors",
      cache: "no-store"
    });
    window.location.replace(backendUrl);
  } catch {
    showFileStartupError();
  }
}

function showLogin() {
  clearMessage();
  loginForm.hidden = false;
  signupForm.hidden = true;
  statusView.hidden = true;
}

function showSignup() {
  clearMessage();
  loginForm.hidden = true;
  signupForm.hidden = false;
  statusView.hidden = true;
  updateRoleFields();
}

function updateRoleFields() {
  const selectedRole = document.querySelector('input[name="role"]:checked');
  const isPsychiatrist = selectedRole?.value === "psychiatrist";
  professionalFields.hidden = !isPsychiatrist;
  professionalName.required = Boolean(isPsychiatrist);
  licenseNumber.required = Boolean(isPsychiatrist);
  licenseDocument.required = Boolean(isPsychiatrist);
  verificationConsent.required = Boolean(isPsychiatrist);
}

function showStatus(title, description) {
  loginForm.hidden = true;
  signupForm.hidden = true;
  statusView.hidden = false;
  document.getElementById("statusTitle").textContent = title;
  document.getElementById("statusDescription").textContent = description;
  clearMessage();
}

function validatePasswordMatch() {
  if (signupPassword.value !== confirmPassword.value) {
    confirmPassword.setCustomValidity("Passwords do not match.");
    return false;
  }
  confirmPassword.setCustomValidity("");
  return true;
}

function validateProfessionalDocument() {
  const file = licenseDocument.files[0];
  if (!file) {
    showMessage("Please select your professional ID or license document.", true);
    return false;
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    showMessage("Use a JPG, PNG, or PDF professional document.", true);
    return false;
  }
  if (file.size > MAX_FILE_SIZE) {
    showMessage("The selected file exceeds the 5 MB limit.", true);
    return false;
  }
  return true;
}

function openDashboard(user) {
  const target = user.role === "psychiatrist"
    ? "/Psychiatrist%20Dashboard/psychiatrist.html"
    : "/Client%20Dashboard/index.html";
  window.location.replace(target);
}

function showOAuthErrorFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const error = params.get("oauth_error");
  if (!error) return false;
  const messages = {
    oauth_not_configured: "Social sign-in is not configured yet. Ask the site administrator to finish the provider setup.",
    oauth_invalid_state: "The sign-in request expired or could not be verified. Please try again.",
    oauth_cancelled: "Sign-in was cancelled. You can try again whenever you are ready.",
    oauth_email_unverified: "Verify your email address with the provider before using social sign-in.",
    oauth_email_missing: "The provider did not share an email address. Allow email access and try again.",
    oauth_account_exists: "An account already uses that email. Sign in with its existing method; accounts are not automatically linked.",
    oauth_account_unavailable: "This account cannot use client social sign-in. Psychiatrist accounts require the separate professional review process.",
    oauth_provider_error: "The provider could not complete sign-in. Please try again later."
  };
  showMessage(messages[error] || messages.oauth_provider_error, true);
  return true;
}

document.getElementById("goSignup").addEventListener("click", showSignup);
document.getElementById("goLogin").addEventListener("click", showLogin);
document.getElementById("backToLogin").addEventListener("click", showLogin);
document.querySelectorAll('input[name="role"]').forEach(input => {
  input.addEventListener("change", updateRoleFields);
});
signupPassword.addEventListener("input", validatePasswordMatch);
confirmPassword.addEventListener("input", validatePasswordMatch);

loginForm.addEventListener("submit", async event => {
  event.preventDefault();
  clearMessage();
  if (!loginForm.reportValidity()) return;

  const button = loginForm.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    const { user } = await requestJson("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: document.getElementById("loginEmail").value,
        password: document.getElementById("loginPassword").value
      })
    });
    openDashboard(user);
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    button.disabled = false;
  }
});

signupForm.addEventListener("submit", async event => {
  event.preventDefault();
  clearMessage();
  if (!signupForm.reportValidity()) return;

  if (!validatePasswordMatch()) {
    confirmPassword.reportValidity();
    return;
  }

  const selectedRole = document.querySelector('input[name="role"]:checked');
  if (!selectedRole) {
    showMessage("Please select an account role.", true);
    return;
  }
  if (selectedRole.value === "psychiatrist" && !validateProfessionalDocument()) {
    return;
  }
  if (selectedRole.value === "psychiatrist" && !verificationConsent.checked) {
    showMessage("Please confirm the professional verification consent.", true);
    return;
  }

  const formData = new FormData();
  formData.set("role", selectedRole.value);
  formData.set("fullName", document.getElementById("fullName").value);
  formData.set("email", document.getElementById("signupEmail").value);
  formData.set("password", signupPassword.value);
  formData.set("termsConsent", String(document.getElementById("termsConsent").checked));
  formData.set("professionalName", professionalName.value);
  formData.set("licenseNumber", licenseNumber.value);
  formData.set("verificationConsent", String(verificationConsent.checked));
  if (licenseDocument.files[0]) {
    formData.set("licenseDocument", licenseDocument.files[0]);
  }

  const button = signupForm.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    const data = await requestJson("/api/auth/register", {
      method: "POST",
      body: formData
    });
    showStatus(
      data.user.role === "psychiatrist" ? "Verification Required" : "Account Created",
      data.message
    );
    signupForm.reset();
    updateRoleFields();
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    button.disabled = false;
  }
});

async function restoreSession() {
  try {
    const { user } = await requestJson("/api/auth/me");
    if (user) openDashboard(user);
  } catch (error) {
    showMessage(error.message, true);
  }
}

updateRoleFields();
if (window.location.protocol === "file:") {
  openBackendFromFile();
} else if (!showOAuthErrorFromUrl()) {
  restoreSession();
}
