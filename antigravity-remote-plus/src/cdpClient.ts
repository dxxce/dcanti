// Chrome DevTools Protocol (CDP) client for Antigravity IDE.
//
// Antigravity IDE is an Electron app. When it is launched with
// `--remote-debugging-port=<port>`, its renderer processes expose a CDP
// endpoint on that loopback port. We connect to the *workbench* renderer
// (the window that hosts the chat panel) and use Runtime.evaluate to:
//   * read the rendered chat DOM (the assistant's actual messages)
//   * type into the chat composer and press send
//
// This is what lets the web UI mirror and drive the exact same conversation
// the user sees in the IDE — both work at the same time. Reading the DOM this
// way sidesteps the LS trajectory format entirely and matches pixel-for-pixel
// what the user sees on screen.
//
// The IDE MUST be started with the flag. We cannot inject it into a running
// process, so `ensureRemoteDebug()` detects whether the port is live and, if
// not, offers to relaunch. Discovery order for the port:
//   1. explicit `port` argument (from config)
//   2. ANTIGRAVITY_REMOTE_DEBUG_PORT env var
//   3. a scan of common ports (9222..9232)

import * as http from "http";
import WebSocket from "ws";

export interface CdpTarget {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

function httpJson(port: number, path: string, timeoutMs = 2500): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host: "127.0.0.1", port, path, timeout: timeoutMs },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c.toString()));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
  });
}

export async function probePort(port: number): Promise<boolean> {
  try {
    const v = await httpJson(port, "/json/version", 1500);
    return Boolean(v && (v.Browser || v.webSocketDebuggerUrl));
  } catch {
    return false;
  }
}

/** Find a live remote-debugging port, trying config -> env -> scan. */
export async function discoverPort(
  preferred?: number
): Promise<number | null> {
  const candidates: number[] = [];
  if (preferred && preferred > 0) candidates.push(preferred);
  const envPort = parseInt(process.env.ANTIGRAVITY_REMOTE_DEBUG_PORT ?? "", 10);
  if (!isNaN(envPort)) candidates.push(envPort);
  for (let p = 9222; p <= 9232; p++) candidates.push(p);
  const seen = new Set<number>();
  for (const p of candidates) {
    if (seen.has(p)) continue;
    seen.add(p);
    if (await probePort(p)) return p;
  }
  return null;
}

async function listTargets(port: number): Promise<CdpTarget[]> {
  const list = await httpJson(port, "/json/list");
  return Array.isArray(list) ? (list as CdpTarget[]) : [];
}

/**
 * Pick the workbench renderer target — the window that hosts the chat panel.
 * Antigravity's main window is a `page` target whose URL contains
 * workbench.html (or the vscode-file workbench). We prefer that; fall back to
 * the first non-devtools page.
 */
function pickWorkbench(targets: CdpTarget[]): CdpTarget | null {
  const pages = targets.filter(
    (t) => t.type === "page" && t.webSocketDebuggerUrl && !t.url.startsWith("devtools://")
  );
  const wb = pages.find(
    (t) => /workbench\.(esm\.)?html/i.test(t.url) || /workbench/i.test(t.title)
  );
  return wb ?? pages[0] ?? null;
}

interface CdpCall {
  resolve: (v: any) => void;
  reject: (e: any) => void;
}

/** A thin CDP session over a single target's websocket. */
export class CdpSession {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, CdpCall>();
  private log: (m: string) => void;
  readonly wsUrl: string;

  constructor(wsUrl: string, log: (m: string) => void = () => {}) {
    this.wsUrl = wsUrl;
    this.log = log;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl, {
        perMessageDeflate: false,
        maxPayload: 64 * 1024 * 1024,
      });
      this.ws = ws;
      const to = setTimeout(() => {
        reject(new Error("CDP connect timeout"));
        ws.terminate();
      }, 5000);
      ws.on("open", () => {
        clearTimeout(to);
        resolve();
      });
      ws.on("message", (data) => this.onMessage(data.toString()));
      ws.on("error", (e) => {
        clearTimeout(to);
        this.log(`[cdp] ws error: ${(e as Error).message}`);
        reject(e);
      });
      ws.on("close", () => {
        for (const { reject: rej } of this.pending.values()) {
          rej(new Error("CDP connection closed"));
        }
        this.pending.clear();
        this.ws = null;
      });
    });
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private onMessage(raw: string) {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.id && this.pending.has(msg.id)) {
      const call = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      if (msg.error) call.reject(new Error(msg.error.message ?? "CDP error"));
      else call.resolve(msg.result);
    }
  }

  send(method: string, params: unknown = {}): Promise<any> {
    if (!this.connected) return Promise.reject(new Error("CDP not connected"));
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws!.send(payload, (err) => {
        if (err) {
          this.pending.delete(id);
          reject(err);
        }
      });
      // Guard against a method that never replies.
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP ${method} timeout`));
        }
      }, 15000);
    });
  }

  /** Evaluate an expression in the page and return the JS value. */
  async evaluate<T = any>(expression: string): Promise<T> {
    const res = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
      allowUnsafeEvalBlockedByCSP: true,
      userGesture: true,
    });
    if (res?.exceptionDetails) {
      throw new Error(
        res.exceptionDetails.exception?.description ??
          res.exceptionDetails.text ??
          "evaluate failed"
      );
    }
    return res?.result?.value as T;
  }

  close() {
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
  }
}

export interface CdpChatMessage {
  role: "user" | "assistant" | "tool";
  text: string;
}

/**
 * High-level CDP client that knows how to talk to the Antigravity chat panel
 * inside the workbench renderer.
 */
export class CdpClient {
  private log: (m: string) => void;
  private session: CdpSession | null = null;
  private port = 0;

  constructor(log: (m: string) => void = () => {}) {
    this.log = log;
  }

  get activePort(): number {
    return this.port;
  }

  isConnected(): boolean {
    return this.session?.connected ?? false;
  }

  /** Connect to the workbench renderer via the given/discovered port. */
  async connect(preferredPort?: number): Promise<boolean> {
    if (this.session?.connected) return true;
    const port = await discoverPort(preferredPort);
    if (!port) {
      this.log("[cdp] no remote-debugging port found");
      return false;
    }
    this.port = port;
    let targets: CdpTarget[];
    try {
      targets = await listTargets(port);
    } catch (e) {
      this.log(`[cdp] listTargets failed: ${(e as Error).message}`);
      return false;
    }
    const wb = pickWorkbench(targets);
    if (!wb?.webSocketDebuggerUrl) {
      this.log("[cdp] no workbench target found");
      return false;
    }
    this.session = new CdpSession(wb.webSocketDebuggerUrl, this.log);
    try {
      await this.session.connect();
      await this.session.send("Runtime.enable", {});
      this.log(`[cdp] connected to workbench on port ${port}`);
      return true;
    } catch (e) {
      this.log(`[cdp] connect failed: ${(e as Error).message}`);
      this.session = null;
      return false;
    }
  }

  disconnect() {
    this.session?.close();
    this.session = null;
  }

  private async ensure(): Promise<boolean> {
    if (this.session?.connected) return true;
    return this.connect(this.port || undefined);
  }

  /**
   * Capture a screenshot of the IDE workbench window as a PNG (base64, no
   * data-uri prefix). Uses CDP Page.captureScreenshot on the workbench target.
   */
  async captureScreenshot(): Promise<string | null> {
    if (!(await this.ensure())) return null;
    try {
      await this.session!.send("Page.enable", {});
      const res = await this.session!.send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: false,
      });
      const data = res?.data;
      return typeof data === "string" && data.length ? data : null;
    } catch (e) {
      this.log(`[cdp] captureScreenshot failed: ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * Read the rendered chat transcript from the DOM. We look for the same
   * containers the IDE uses for chat content and return them in order.
   */
  async readMessages(): Promise<CdpChatMessage[] | null> {
    if (!(await this.ensure())) return null;
    // Runs inside the renderer; returns a plain array.
    const expr = `(() => {
      const out = [];
      const sels = [
        '.chat-message', '[data-message-role]',
        '.markdown-body', '.rendered-markdown', '.chat-message-content'
      ];
      let nodes = [];
      for (const s of sels) {
        const found = document.querySelectorAll(s);
        if (found.length) { nodes = Array.from(found); break; }
      }
      for (const n of nodes) {
        const roleAttr = (n.getAttribute && (n.getAttribute('data-message-role') ||
          n.getAttribute('data-role'))) || '';
        let role = /user/i.test(roleAttr) ? 'user'
          : /assistant|ai|model/i.test(roleAttr) ? 'assistant'
          : (n.closest && n.closest('[data-message-role="user"]')) ? 'user'
          : 'assistant';
        const text = (n.innerText || '').trim();
        if (text) out.push({ role, text });
      }
      return out;
    })()`;
    try {
      return await this.session!.evaluate<CdpChatMessage[]>(expr);
    } catch (e) {
      this.log(`[cdp] readMessages failed: ${(e as Error).message}`);
      return null;
    }
  }

  /** Whether the panel currently shows a "generating/stop" affordance. */
  async isGenerating(): Promise<boolean> {
    if (!(await this.ensure())) return false;
    const expr = `(() => {
      const stop = document.querySelector(
        '[aria-label*="Stop" i], [title*="Stop" i], .codicon-debug-stop, .generating, [data-generating="true"]'
      );
      return !!stop;
    })()`;
    try {
      return await this.session!.evaluate<boolean>(expr);
    } catch {
      return false;
    }
  }

  /**
   * Type a message into the chat composer and submit it. We set the value on
   * the textarea/contenteditable, dispatch input events so the framework
   * registers it, then press Enter.
   */
  async sendMessage(text: string): Promise<boolean> {
    if (!(await this.ensure())) return false;
    const json = JSON.stringify(text);
    const expr = `(() => {
      const box = document.querySelector(
        'textarea[placeholder], .chat-input textarea, [contenteditable="true"].chat-input, .inputarea, [role="textbox"]'
      );
      if (!box) return false;
      const val = ${json};
      if (box.tagName === 'TEXTAREA' || box.tagName === 'INPUT') {
        const setter = Object.getOwnPropertyDescriptor(box.__proto__, 'value')?.set;
        setter ? setter.call(box, val) : (box.value = val);
        box.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        box.focus();
        box.textContent = val;
        box.dispatchEvent(new InputEvent('input', { bubbles: true }));
      }
      box.focus();
      const ev = (type) => box.dispatchEvent(new KeyboardEvent(type, {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true
      }));
      ev('keydown'); ev('keypress'); ev('keyup');
      return true;
    })()`;
    try {
      return await this.session!.evaluate<boolean>(expr);
    } catch (e) {
      this.log(`[cdp] sendMessage failed: ${(e as Error).message}`);
      return false;
    }
  }

  /**
   * Best-effort model selection through the webview. The Cascade model picker
   * lives in the renderer, so we try to find a menu/button whose text matches
   * the model label and click it. This is inherently fragile (depends on the
   * IDE's DOM), so callers must not rely on the return value for correctness.
   */
  async selectModel(modelLabel: string): Promise<boolean> {
    if (!(await this.ensure())) return false;
    const json = JSON.stringify(modelLabel);
    const expr = `(() => {
      const want = ${json};
      const norm = (s) => (s || '').toLowerCase().replace(/\\s+/g, ' ').trim();
      const target = norm(want);

      function searchDoc(root) {
        if (!root) return null;
        const nodes = Array.from(root.querySelectorAll('button, div, span, [role="button"], [role="menuitem"], [role="option"]'));
        for (const n of nodes) {
          const t = norm(n.innerText || n.textContent || n.getAttribute('title') || n.getAttribute('aria-label'));
          if (t && (t === target || t.includes(target) || target.includes(t))) {
            return n;
          }
        }
        const allElements = root.querySelectorAll('*');
        for (const el of allElements) {
          if (el.shadowRoot) {
            const found = searchDoc(el.shadowRoot);
            if (found) return found;
          }
        }
        const iframes = root.querySelectorAll('iframe, webview');
        for (const f of iframes) {
          try {
            const doc = f.contentDocument || (f.contentWindow && f.contentWindow.document);
            if (doc) {
              const found = searchDoc(doc);
              if (found) return found;
            }
          } catch {}
        }
        return null;
      }

      function clickDropdown(root) {
        if (!root) return false;
        const triggers = Array.from(root.querySelectorAll('button, div, span')).filter((el) => {
          const cl = String(el.className || '').toLowerCase();
          const tt = String(el.getAttribute('title') || '').toLowerCase();
          const al = String(el.getAttribute('aria-label') || '').toLowerCase();
          const txt = norm(el.innerText || el.textContent);
          return (cl.includes('model') || tt.includes('model') || al.includes('model') || txt.includes('sonnet') || txt.includes('gemini') || txt.includes('gpt'));
        });
        if (triggers.length > 0) {
          try { (triggers[0]).click(); return true; } catch {}
        }
        const allElements = root.querySelectorAll('*');
        for (const el of allElements) {
          if (el.shadowRoot && clickDropdown(el.shadowRoot)) return true;
        }
        return false;
      }

      clickDropdown(document);

      const hit = searchDoc(document);
      if (hit) {
        try { (hit).click(); return true; } catch {}
      }
      return false;
    })()`;
    try {
      return await this.session!.evaluate<boolean>(expr);
    } catch (e) {
      this.log(`[cdp] selectModel failed: ${(e as Error).message}`);
      return false;
    }
  }

  /**
   * Switch/open a conversation by ID in the IDE webview/DOM.
   */
  async openConversation(conversationId: string): Promise<boolean> {
    if (!conversationId || !(await this.ensure())) return false;
    const json = JSON.stringify(conversationId);
    const expr = `(() => {
      const id = ${json};
      function searchAndClick(root) {
        if (!root) return false;
        try {
          const el = root.querySelector(\`[data-cascade-id="\${id}"], [data-conversation-id="\${id}"], [data-id="\${id}"]\`);
          if (el) {
            (el).click();
            return true;
          }
          const links = Array.from(root.querySelectorAll('a, button, div, span, [role="treeitem"], [role="listitem"]'));
          for (const l of links) {
            const href = l.getAttribute('href') || '';
            const key = l.getAttribute('data-key') || '';
            const title = l.getAttribute('title') || '';
            if (href.includes(id) || key.includes(id) || title.includes(id)) {
              (l).click();
              return true;
            }
          }
        } catch {}
        const iframes = root.querySelectorAll('iframe, webview');
        for (const f of iframes) {
          try {
            const doc = f.contentDocument || (f.contentWindow && f.contentWindow.document);
            if (doc && searchAndClick(doc)) return true;
          } catch {}
        }
        return false;
      }
      return searchAndClick(document);
    })()`;
    try {
      return await this.session!.evaluate<boolean>(expr);
    } catch {
      return false;
    }
  }

  /**
   * Click revert button for a specific step in the IDE DOM.
   */
  async revertToStep(stepIndex: number): Promise<boolean> {
    if (stepIndex == null || !(await this.ensure())) return false;
    const expr = `(() => {
      const target = ${stepIndex};
      function searchAndClick(root) {
        if (!root) return false;
        try {
          const btns = Array.from(root.querySelectorAll('button, [role="button"], [data-step-index], [data-index]'));
          for (const b of btns) {
            const stepAttr = b.getAttribute('data-step-index') || b.getAttribute('data-index') || '';
            const t = (b.textContent || b.getAttribute('title') || b.getAttribute('aria-label') || '').toLowerCase();
            if ((t.includes('revert') || t.includes('quay lại')) && (stepAttr === String(target) || !stepAttr)) {
              (b).click();
              return true;
            }
          }
        } catch {}
        const iframes = root.querySelectorAll('iframe, webview');
        for (const f of iframes) {
          try {
            const doc = f.contentDocument || (f.contentWindow && f.contentWindow.document);
            if (doc && searchAndClick(doc)) return true;
          } catch {}
        }
        return false;
      }
      return searchAndClick(document);
    })()`;
    try {
      return await this.session!.evaluate<boolean>(expr);
    } catch {
      return false;
    }
  }

  /**
   * Answer or skip an interactive question directly inside the IDE DOM.
   */
  async answerQuestion(options?: {
    optionIndices?: number[];
    freeText?: string;
    isSkip?: boolean;
  }): Promise<boolean> {
    if (!(await this.ensure())) return false;
    const json = JSON.stringify(options || {});
    const expr = `(() => {
      const opts = ${json};
      function searchAll(root) {
        if (!root) return [];
        let res = [];
        try {
          res.push(...Array.from(root.querySelectorAll('button, [role="button"], input, textarea, .interactive-card, [data-testid]')));
        } catch {}
        const iframes = root.querySelectorAll('iframe, webview');
        for (const f of iframes) {
          try {
            const doc = f.contentDocument || (f.contentWindow && f.contentWindow.document);
            if (doc) res.push(...searchAll(doc));
          } catch {}
        }
        return res;
      }

      const elements = searchAll(document);
      const norm = (s) => (s || '').toLowerCase().trim();

      if (opts.isSkip) {
        const skipBtn = elements.find(el => {
          const t = norm(el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title'));
          return (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') && (t === 'skip' || t.includes('skip') || t.includes('bỏ qua'));
        });
        if (skipBtn) {
          try { (skipBtn).click(); return true; } catch {}
        }
      }

      if (opts.freeText) {
        const input = elements.find(el => {
          return (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && (
            norm(el.placeholder).includes('type') ||
            norm(el.placeholder).includes('nhập') ||
            norm(el.placeholder).includes('other') ||
            norm(el.placeholder).includes('answer')
          );
        });
        if (input) {
          try {
            (input).focus();
            (input).value = opts.freeText;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          } catch {}
        }
      }

      if (Array.isArray(opts.optionIndices) && opts.optionIndices.length > 0) {
        const optionBtns = elements.filter(el => {
          const cl = norm(el.className);
          const t = norm(el.innerText || el.textContent);
          return (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') && (cl.includes('option') || cl.includes('choice') || /^[0-9]\\b/.test(t));
        });
        for (const idx of opts.optionIndices) {
          const target = optionBtns[idx] || optionBtns.find(b => norm(b.innerText).startsWith(String(idx + 1)));
          if (target) {
            try { (target).click(); } catch {}
          }
        }
      }

      // Finally find and click "Submit" button
      if (!opts.isSkip) {
        const submitBtn = elements.find(el => {
          const t = norm(el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title'));
          return (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') && (t === 'submit' || t.includes('submit') || t.includes('gửi'));
        });
        if (submitBtn) {
          try { (submitBtn).click(); return true; } catch {}
        }
      }

      return false;
    })()`;
    try {
      return await this.session!.evaluate<boolean>(expr);
    } catch (e) {
      this.log(`[cdp] answerQuestion failed: ${(e as Error).message}`);
      return false;
    }
  }
}
