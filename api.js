"use strict";

window.atipApi = {
  async request(url, options = {}) {
    let response;
    try {
      response = await fetch(url, {
        credentials: "same-origin",
        ...options,
        headers: {
          ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
          ...options.headers
        }
      });
    } catch {
      const error = new Error(
        "Cannot reach the ATIP server. Start it with `npm start`, then open http://127.0.0.1:3000/ (not a file:// page)."
      );
      error.networkError = true;
      throw error;
    }

    let data = {};
    try {
      data = await response.json();
    } catch (error) {
      if (response.ok) throw new Error("The server returned an invalid response.");
    }

    if (response.status === 401) {
      window.location.replace("/AUTH/auth.html");
      throw new Error(data.error || "Please sign in again.");
    }
    if (!response.ok) {
      const error = new Error(data.error || "The request could not be completed.");
      error.status = response.status;
      throw error;
    }
    return data;
  },

  async account(role) {
    const { user } = await this.request("/api/auth/me");
    if (!user || user.role !== role || user.status !== "active") {
      window.location.replace("/AUTH/auth.html");
      throw new Error("This account cannot access this dashboard.");
    }
    return user;
  }
};
