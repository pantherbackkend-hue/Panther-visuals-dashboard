class NotificationManager {
  constructor(shopId) {
    this.shopId = shopId;
    this.pendingOrderCount = 0;
    this.originalTitle = document.title;
    this.audio = null;
    this.isPlaying = false;
    this.socket = null;

    this.connect();
  }

  connect() {
    this.socket = io({ transports: ["websocket", "polling"] });

    this.socket.on("connect", () => {
      if (this.shopId) {
        this.socket.emit("editor:join", this.shopId);
      }
    });

    this.socket.on("pending-count", (count) => {
      this.pendingOrderCount = count;
      this.updateState();
    });
  }

  updateState() {
    this.updateTitle();
    this.updateSound();
  }

  updateTitle() {
    if (this.pendingOrderCount > 0) {
      document.title = `(${this.pendingOrderCount}) Pending Orders - Panther Visuals`;
    } else {
      document.title = this.originalTitle;
    }
  }

  updateSound() {
    if (this.pendingOrderCount > 0) {
      this.startRinging();
    } else {
      this.stopRinging();
    }
  }

  startRinging() {
    if (this.isPlaying) return;

    this.isPlaying = true;
    this.audio = new Audio("/audio/ringing_sound.mp3");
    this.audio.loop = true;
    this.audio.volume = 1.0;

    this.audio.play().catch(() => {
      const resume = () => {
        if (this.isPlaying && this.audio) {
          this.audio.play();
        }
        document.removeEventListener("click", resume);
      };
      document.addEventListener("click", resume, { once: true });
    });
  }

  stopRinging() {
    if (!this.isPlaying) return;

    this.isPlaying = false;
    if (this.audio) {
      this.audio.pause();
      this.audio.currentTime = 0;
      this.audio = null;
    }
  }

  destroy() {
    this.stopRinging();
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }
}

class NotificationBell {
  constructor(opts) {
    this.unreadCount = 0;
    this.role = (opts && opts.role) || document.body.dataset.role;
    this.userId = (opts && opts.userId) || document.body.dataset.userId;
    this.socket = io({ transports: ["websocket", "polling"] });
    this.setupSocket();
    this.setupDropdown();
    this.setupMarkAllRead();
    this.fetchUnreadCount();
  }

  setupMarkAllRead() {
    const btn = document.querySelector("[data-mark-all-read]");
    if (!btn) return;
    btn.addEventListener("click", async () => {
      try {
        await fetch("/api/notifications/read-all", { method: "POST" });
        this.unreadCount = 0;
        this.updateBadge();
        document.querySelectorAll(".notif-item--unread").forEach((el) => {
          el.classList.remove("notif-item--unread");
          const btn = el.querySelector("[data-mark-read]");
          if (btn) btn.remove();
        });
      } catch (err) {
        console.error("Failed to mark all read:", err);
      }
    });
  }

  setupSocket() {
    this.socket.on("connect", () => {
      if (this.userId) this.socket.emit("user:join", this.userId);
      if (this.role) this.socket.emit("role:join", this.role);
    });

    this.socket.on("notification", (notif) => {
      this.unreadCount++;
      this.updateBadge();
      this.prependNotification(notif);
    });

    this.socket.on("dashboard:counts", (counts) => {
      const els = document.querySelectorAll("[data-dashboard-count]");
      els.forEach((el) => {
        const key = el.dataset.dashboardCount;
        if (counts[key] !== undefined) {
          el.textContent = counts[key];
        }
      });
    });
  }

  setupDropdown() {
    document.addEventListener("click", (e) => {
      const bell = e.target.closest("[data-notif-bell]");
      const dropdown = document.querySelector("[data-notif-dropdown]");
      if (!dropdown) return;

      if (bell) {
        e.preventDefault();
        dropdown.classList.toggle("is-visible");
        if (dropdown.classList.contains("is-visible")) {
          this.fetchNotifications();
        }
        return;
      }

      if (!dropdown.contains(e.target)) {
        dropdown.classList.remove("is-visible");
      }
    });
  }

  async fetchUnreadCount() {
    try {
      const res = await fetch("/api/notifications/unread-count");
      const data = await res.json();
      this.unreadCount = data.count || 0;
      this.updateBadge();
    } catch (err) {
      console.error("Failed to fetch unread count:", err);
    }
  }

  async fetchNotifications() {
    try {
      const res = await fetch("/api/notifications");
      const data = await res.json();
      const list = document.querySelector("[data-notif-list]");
      if (!list) return;
      list.innerHTML = "";
      (data.notifications || []).forEach((n) => this.renderNotification(list, n));
    } catch (err) {
      console.error("Failed to fetch notifications:", err);
    }
  }

  renderNotification(list, notif) {
    const li = document.createElement("li");
    li.className = "notif-item" + (notif.read ? "" : " notif-item--unread");
    li.dataset.id = notif._id;
    li.innerHTML = `
      <a href="${notif.actionUrl || "#"}" class="notif-link">
        <p class="notif-title">${notif.title}</p>
        ${notif.message ? `<p class="notif-msg">${notif.message}</p>` : ""}
        <p class="notif-time">${new Date(notif.createdAt).toLocaleString("en-IN")}</p>
      </a>
      ${notif.read ? "" : '<button class="notif-mark-read" data-mark-read="' + notif._id + '" aria-label="Mark read">&times;</button>'}
    `;

    const markBtn = li.querySelector("[data-mark-read]");
    if (markBtn) {
      markBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await this.markRead(notif._id);
      });
    }

    list.appendChild(li);
  }

  prependNotification(notif) {
    const list = document.querySelector("[data-notif-list]");
    if (!list) return;
    this.renderNotification(list, notif);
    const first = list.firstChild;
    if (first) list.insertBefore(list.lastChild, first);
    this.updateBadge();
  }

  updateBadge() {
    const badge = document.querySelector("[data-notif-badge]");
    if (!badge) return;
    if (this.unreadCount > 0) {
      badge.textContent = this.unreadCount > 99 ? "99+" : String(this.unreadCount);
      badge.style.display = "flex";
    } else {
      badge.style.display = "none";
    }
  }

  async markRead(id) {
    try {
      await fetch(`/api/notifications/${id}/read`, { method: "POST" });
      const item = document.querySelector(`[data-id="${id}"]`);
      if (item) {
        item.classList.remove("notif-item--unread");
        const btn = item.querySelector("[data-mark-read]");
        if (btn) btn.remove();
      }
      this.unreadCount = Math.max(0, this.unreadCount - 1);
      this.updateBadge();
    } catch (err) {
      console.error("Failed to mark notification read:", err);
    }
  }
}
