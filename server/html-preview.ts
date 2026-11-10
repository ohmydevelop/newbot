import { PublicError } from "./public-error.js";
import { randomBytes } from "node:crypto";
import type { ArtifactStore } from "./artifacts.js";
import { hash, type Store } from "./db.js";
export const PREVIEW_TTL = 5 * 60_000;
export const CONTENT_POLICY =
  "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
export const PREVIEW_PERMISSIONS =
  "camera=(), microphone=(), geolocation=(), clipboard-read=(), clipboard-write=(), display-capture=(), fullscreen=(), payment=(), usb=(), serial=()";
type Grant = {
  id: string;
  artifactId: string;
  owner: string;
  appOrigin: string;
  mainOrigin: string;
  expiresAt: number;
};
// Only ephemeral capabilities are retained; the HTML stays in the immutable file store.
export function htmlPreviews(
  db: Store,
  artifacts: ArtifactStore,
  now = Date.now,
) {
  const grants = new Map<string, Grant>();
  const active = (owner: string) =>
    !!db.raw
      .prepare("SELECT token FROM sessions WHERE token=? AND expires>?")
      .get(owner, now());
  function prune() {
    for (const [id, g] of grants)
      if (g.expiresAt <= now() || !active(g.owner)) grants.delete(id);
  }
  function capacity(owner: string) {
    prune();
    if (
      grants.size >= 32 ||
      [...grants.values()].filter((g) => g.owner === owner).length >= 8
    )
      throw new PublicError("预览窗口过多，请关闭其他预览后重试");
  }
  return {
    prune,
    async issue(
      artifactId: string,
      session: string,
      appOrigin: string,
      mainOrigin: string,
    ) {
      if (!db.validSession(session)) throw new PublicError("登录已过期");
      if (
        appOrigin === mainOrigin ||
        new URL(appOrigin).host === new URL(mainOrigin).host
      )
        throw new PublicError("HTML 预览需要独立的应用地址");
      const owner = hash(session);
      capacity(owner);
      if (artifacts.get(artifactId).kind !== "html")
        throw new PublicError("此文件不支持 HTML 运行预览");
      await artifacts.read(artifactId); // Verify the bounded snapshot before issuing a capability.
      capacity(owner);
      if (!active(owner)) throw new PublicError("登录已过期");
      const id = randomBytes(32).toString("base64url");
      const grant = {
        id,
        artifactId,
        owner,
        appOrigin,
        mainOrigin,
        expiresAt: now() + PREVIEW_TTL,
      };
      grants.set(id, grant);
      return {
        previewId: id,
        url: `${appOrigin}/artifact-preview/${id}`,
        expiresAt: grant.expiresAt,
      };
    },
    find(id: string, host: string) {
      prune();
      const grant = grants.get(id);
      return grant && new URL(grant.appOrigin).host === host
        ? grant
        : undefined;
    },
    revoke(id: string, artifactId: string, session: string) {
      const grant = grants.get(id);
      if (
        grant &&
        (grant.owner !== hash(session) || grant.artifactId !== artifactId)
      )
        throw new PublicError("预览不存在");
      grants.delete(id);
    },
    revokeSession(session: string) {
      const owner = hash(session);
      for (const [id, g] of grants) if (g.owner === owner) grants.delete(id);
    },
    clear() {
      grants.clear();
    },
  };
}
export function previewShell(grant: Grant) {
  const nonce = randomBytes(18).toString("base64url");
  const contentURL = `${grant.appOrigin}/artifact-content/${grant.id}`;
  const policy = `sandbox allow-scripts; default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; frame-src ${contentURL}; connect-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors ${grant.mainOrigin}`;
  // No user HTML is interpolated into this trusted outer document. The exact frame-src
  // path also constrains navigation of the inner frame, including in older browsers.
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><style nonce="${nonce}">html,body{margin:0;width:100%;height:100%;overflow:hidden}iframe{border:0;width:100%;height:100%;display:block;background:white}</style></head><body><script nonce="${nonce}">
const id=${JSON.stringify(grant.id)},target=${JSON.stringify(grant.mainOrigin)};
const notify=state=>parent.postMessage({type:"newbot.html-preview",previewId:id,state},target);
const frame=document.createElement("iframe");frame.title="HTML page";frame.sandbox="allow-scripts";frame.referrerPolicy="no-referrer";
frame.allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; display-capture 'none'; fullscreen 'none'; payment 'none'";
let failed=false,challenge=0,timer;
addEventListener("keydown",event=>{if(event.key==="Escape")notify("close")},true);
addEventListener("message",event=>{
if(event.source!==frame.contentWindow||event.data?.previewId!==id)return;
if(!failed&&event.data.type==="newbot.html-preview.escape")notify("close");
else if(event.data.type==="newbot.html-preview.error"){failed=true;clearTimeout(timer);notify("error")}
else if(!failed&&event.data.type==="newbot.html-preview.ready"&&event.data.challenge===challenge){clearTimeout(timer);notify("ready")}
});
frame.onload=()=>{if(failed)return;notify("loading");clearTimeout(timer);challenge++;timer=setTimeout(()=>{failed=true;notify("error")},5000);frame.contentWindow.postMessage({type:"newbot.html-preview.ping",previewId:id,challenge},"*")};frame.onerror=()=>{failed=true;clearTimeout(timer);notify("error")};
frame.src=${JSON.stringify(contentURL)};document.body.append(frame);
</script></body></html>`;
  return { html, policy, allowlist: `(${JSON.stringify(contentURL)})` };
}
export function previewFailure(id: string) {
  // Used only on the isolated host, under an HTTP sandbox. Payloads never include user HTML.
  const safe = JSON.stringify(id).replaceAll("<", "\\u003c");
  return `<!doctype html><html><meta charset="utf-8"><body><p>预览已失效，请重新加载。</p><script>parent.postMessage({type:"newbot.html-preview.error",previewId:${safe}},"*");parent.postMessage({type:"newbot.html-preview",previewId:${safe},state:"error"},"*");</script></body></html>`;
}

export function previewContent(html: string, id: string) {
  // A lifecycle-only responder precedes user scripts. It cannot call tools or read
  // host data. The outer shell challenges each loaded document, including reloads,
  // so browser error documents cannot be mistaken for a running artifact.
  const safe = JSON.stringify(id).replaceAll("<", "\\u003c");
  const bootstrap = `<script>(()=>{const host=parent,id=${safe},post=host.postMessage.bind(host);addEventListener("message",event=>{if(event.source===host&&event.data?.type==="newbot.html-preview.ping"&&event.data.previewId===id&&typeof event.data.challenge==="number")post({type:"newbot.html-preview.ready",previewId:id,challenge:event.data.challenge},"*")});addEventListener("keydown",event=>{if(event.key==="Escape")post({type:"newbot.html-preview.escape",previewId:id},"*")},true)})();</script>`;
  return `<!doctype html>${bootstrap}${html.replace(/^\uFEFF?\s*<!doctype[^>]*>/i, "")}`;
}
