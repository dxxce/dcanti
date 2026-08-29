// Notification sound, Web Notification & haptic feedback helper
export async function requestNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (!("Notification" in window)) return "unsupported";
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export function playNotificationSound() {
  try {
    if (localStorage.getItem("agy_sound") === "false") return;
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.12); // A5
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);

    // Trigger haptic vibration on mobile devices if supported
    if ("vibrate" in navigator) {
      navigator.vibrate([40, 60, 40]);
    }
  } catch {}
}

export function notifyAgentCompleted(title = "Antigravity Remote", body = "Agent đã trả lời xong!") {
  // Trigger sound & haptic
  playNotificationSound();

  // Trigger web notification if enabled
  if (localStorage.getItem("agy_notify_complete") !== "false") {
    try {
      if ("Notification" in window && Notification.permission === "granted") {
        if ("serviceWorker" in navigator && navigator.serviceWorker.ready) {
          navigator.serviceWorker.ready
            .then((reg) => {
              reg.showNotification(title, {
                body,
                icon: "icon.png",
                badge: "icon.png",
                tag: "agent-complete-" + Date.now(),
              });
            })
            .catch(() => {
              new Notification(title, {
                body,
                icon: "icon.png",
                badge: "icon.png",
                tag: "agent-complete-" + Date.now(),
              });
            });
        } else {
          new Notification(title, {
            body,
            icon: "icon.png",
            badge: "icon.png",
            tag: "agent-complete-" + Date.now(),
          });
        }
      }
    } catch {}
  }
}

export function playQuestionSound() {
  try {
    if (localStorage.getItem("agy_sound") === "false") return;
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(440, ctx.currentTime); // A4
    osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.15); // E5
    gain.gain.setValueAtTime(0.14, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);

    if ("vibrate" in navigator) {
      navigator.vibrate([60, 80, 60]);
    }
  } catch {}
}
