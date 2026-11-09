// Storage layer: reads and writes files in the game-data repository.
// GitHubStore talks to the GitHub API; LocalStore talks to tools/devserver.py for offline testing.

export class ConflictError extends Error {
  constructor(path) { super(`다른 곳에서 먼저 수정했어요: ${path}`); this.path = path; }
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export function textToB64(text) {
  return bytesToB64(enc.encode(text));
}
export function bytesToB64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(bin);
}
function b64ToText(b64) {
  const bin = atob(b64.replace(/\n/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return dec.decode(bytes);
}

class BaseStore {
  constructor() { this.blobCache = new Map(); }

  async getJSON(path, fallback = null) {
    const f = await this.getText(path);
    if (!f) return { data: fallback, sha: null };
    return { data: JSON.parse(f.text), sha: f.sha };
  }

  async saveJSON(path, data, sha, message) {
    return this.putText(path, JSON.stringify(data, null, 2) + '\n', sha, message);
  }

  // Load the latest version, apply fn, save. Retries when someone else saved in between.
  async updateJSON(path, fn, message, fallback = {}) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data, sha } = await this.getJSON(path, structuredClone(fallback));
      const next = (await fn(data)) ?? data;
      try {
        await this.saveJSON(path, next, sha, message);
        return next;
      } catch (e) {
        if (!(e instanceof ConflictError) || attempt === 2) throw e;
      }
    }
  }

  async blobUrl(path) {
    if (this.blobCache.has(path)) return this.blobCache.get(path);
    const p = this.getRaw(path).then(b => URL.createObjectURL(b));
    this.blobCache.set(path, p);
    try { return await p; } catch (e) { this.blobCache.delete(path); throw e; }
  }
  forgetBlob(path) { this.blobCache.delete(path); }
}

export class GitHubStore extends BaseStore {
  constructor({ token, owner, repo, branch = 'main' }) {
    super();
    Object.assign(this, { token, owner, repo, branch });
    this.label = `${owner}/${repo}`;
  }

  async api(path, opts = {}) {
    const res = await fetch(`https://api.github.com${path}`, {
      ...opts,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: opts.accept || 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
    return res;
  }

  url(path) { return `/repos/${this.owner}/${this.repo}/contents/${encodeURI(path)}`; }

  async check() {
    const r = await this.api(`/repos/${this.owner}/${this.repo}`);
    if (r.status === 401) throw new Error('열쇠(토큰)가 올바르지 않아요.');
    if (r.status === 404) throw new Error('저장소를 찾을 수 없어요. 토큰에 이 저장소 접근 권한이 있는지 확인해 주세요.');
    if (!r.ok) throw new Error(`연결 실패 (${r.status})`);
    const repo = await r.json();
    if (repo.permissions && !repo.permissions.push) throw new Error('읽기 권한만 있어요. 토큰 권한을 "Read and write"로 설정해 주세요.');
    return repo;
  }

  async getText(path) {
    const r = await this.api(`${this.url(path)}?ref=${this.branch}&t=${Date.now()}`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`불러오기 실패 (${r.status}): ${path}`);
    const j = await r.json();
    if (j.content || j.size === 0) return { text: j.content ? b64ToText(j.content) : '', sha: j.sha };
    // Files over 1MB come without content; fetch the raw bytes instead.
    const raw = await this.api(`${this.url(path)}?ref=${this.branch}`, { accept: 'application/vnd.github.raw' });
    return { text: await raw.text(), sha: j.sha };
  }

  async put(path, b64, sha, message) {
    const r = await this.api(this.url(path), {
      method: 'PUT',
      body: JSON.stringify({ message: `[편집실] ${message}`, content: b64, branch: this.branch, ...(sha ? { sha } : {}) }),
    });
    if (r.status === 409 || r.status === 422) throw new ConflictError(path);
    if (!r.ok) throw new Error(`저장 실패 (${r.status}): ${path}`);
    const j = await r.json();
    return j.content.sha;
  }
  putText(path, text, sha, message) { return this.put(path, textToB64(text), sha, message); }
  putBinary(path, b64, sha, message) { this.forgetBlob(path); return this.put(path, b64, sha, message); }

  async remove(path, sha, message) {
    const r = await this.api(this.url(path), {
      method: 'DELETE',
      body: JSON.stringify({ message: `[편집실] ${message}`, sha, branch: this.branch }),
    });
    if (!r.ok) throw new Error(`삭제 실패 (${r.status}): ${path}`);
  }

  async list(dir) {
    const r = await this.api(`${this.url(dir)}?ref=${this.branch}&t=${Date.now()}`);
    if (r.status === 404) return [];
    if (!r.ok) throw new Error(`목록 불러오기 실패 (${r.status}): ${dir}`);
    const j = await r.json();
    return (Array.isArray(j) ? j : []).map(x => ({ name: x.name, path: x.path, type: x.type === 'dir' ? 'dir' : 'file', sha: x.sha, size: x.size }));
  }

  async getRaw(path) {
    const r = await this.api(`${this.url(path)}?ref=${this.branch}`, { accept: 'application/vnd.github.raw' });
    if (!r.ok) throw new Error(`파일 불러오기 실패 (${r.status}): ${path}`);
    return r.blob();
  }

  async commits(n = 15) {
    const r = await this.api(`/repos/${this.owner}/${this.repo}/commits?sha=${this.branch}&per_page=${n}`);
    if (!r.ok) return [];
    return (await r.json()).map(c => ({
      sha: c.sha, message: c.commit.message, date: c.commit.author.date,
      author: c.commit.author.name, url: c.html_url,
    }));
  }
}

export class LocalStore extends BaseStore {
  constructor(base = '/__repo') { super(); this.base = base; this.label = '로컬 테스트'; }
  async j(path, opts) {
    const r = await fetch(this.base + path, opts);
    if (r.status === 404) return null;
    if (r.status === 409) throw new ConflictError(path);
    if (!r.ok) throw new Error(`로컬 서버 오류 (${r.status})`);
    return r.json();
  }
  check() { return this.j('/ping'); }
  getText(path) { return this.j(`/file?path=${encodeURIComponent(path)}`); }
  async putText(path, text, sha, message) {
    return (await this.j('/file', { method: 'PUT', body: JSON.stringify({ path, text, sha, message }) })).sha;
  }
  async putBinary(path, b64, sha, message) {
    this.forgetBlob(path);
    return (await this.j('/file', { method: 'PUT', body: JSON.stringify({ path, b64, sha, message }) })).sha;
  }
  async remove(path, sha, message) { await this.j('/file', { method: 'DELETE', body: JSON.stringify({ path, sha, message }) }); }
  async list(dir) { return (await this.j(`/list?path=${encodeURIComponent(dir)}`)) || []; }
  async getRaw(path) {
    const r = await fetch(`${this.base}/raw?path=${encodeURIComponent(path)}`);
    if (!r.ok) throw new Error(`파일 불러오기 실패: ${path}`);
    return r.blob();
  }
  async commits(n = 15) { return (await this.j(`/commits?n=${n}`)) || []; }
}
