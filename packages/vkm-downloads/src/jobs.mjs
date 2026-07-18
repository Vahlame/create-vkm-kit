/**
 * Background download jobs — the answer to "download large files or SETS of files, fast or slow."
 *
 * A synchronous tool call can't outlast the MCP transport's ~60s wall, so a multi-GB or slow
 * download can't be a single `download_file`. Instead `download_start` registers a job and returns
 * a job_id IMMEDIATELY; the transfer runs as a floating async task inside this long-lived stdio
 * server (no child process — the "never spawn" security property of the package holds), and the
 * agent polls `download_status` / can `download_cancel`. Because streaming is async I/O it doesn't
 * block the event loop, so status/cancel are served while a download is in flight.
 *
 * Each file:
 *   - picks the fastest of its mirror URLs (probeMirrors) when there's more than one;
 *   - streams to `<name>.part`, RESUMING via HTTP Range if a `.part` from a prior interrupted run
 *     exists (falls back to a clean restart if the server ignores Range);
 *   - is guarded exactly like the sync path (http(s)-only, IP-pinned, private ranges refused,
 *     root-checked destination, byte cap) PLUS a free-disk-space check for large files;
 *   - renames `.part` → final (no-overwrite de-dup) and reports path/size/sha256 on completion.
 *
 * Every network seam is injectable (deps + now) so the whole manager is testable offline. Jobs live
 * in this process only: a Claude Code restart ends in-flight jobs, but their `.part` files let a
 * re-issued `download_start` resume instead of restarting.
 */
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, statSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  openStream,
  resolveDeps,
  assertDiskSpace,
  envMaxBytesBackground,
  DEFAULT_IDLE_MS,
  DownloadHttpError,
  DownloadSizeError,
  downloadDir
} from "./download.mjs";
import { deriveFilename, resolveWithinRoot, safeJoin } from "./filename.mjs";
import { pickFastest } from "./mirror.mjs";

const DEFAULT_CONCURRENCY = 3;
const PROGRESS_PERSIST_MS = 1000;

/** Total size out of a `Content-Range: bytes 0-1/12345` header, else null. */
function totalFromContentRange(cr) {
  const m = /\/(\d+)\s*$/.exec(String(cr || ""));
  return m ? Number(m[1]) : null;
}

/** SHA-256 of a file on disk (used after a resumed download, where the running hash is incomplete). */
function sha256OfFile(p) {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(p)
      .on("data", (c) => h.update(c))
      .on("end", () => resolve(h.digest("hex")))
      .on("error", reject);
  });
}

/** Strip internal (`_`-prefixed) fields for a JSON-safe snapshot. */
function publicFile(f) {
  const out = {};
  for (const [k, v] of Object.entries(f)) if (!k.startsWith("_")) out[k] = v;
  return out;
}
function publicJob(job) {
  return {
    job_id: job.job_id,
    state: job.state,
    created_at: job.created_at,
    finished_at: job.finished_at || null,
    dest_dir: job.dest_dir,
    files: job.files.map(publicFile)
  };
}

export class JobManager {
  /**
   * @param {{ deps?, idleMs?: number, now?: () => number, stateDir?: string, concurrency?: number }} [opts]
   */
  constructor(opts = {}) {
    this._jobs = new Map();
    this._deps = resolveDeps(opts);
    this._idleMs = opts.idleMs || DEFAULT_IDLE_MS;
    this._now = opts.now || Date.now;
    this._concurrency = opts.concurrency || DEFAULT_CONCURRENCY;
    this._stateDir = opts.stateDir || path.join(homedir(), ".vkm", "downloads", "jobs");
    this._pickFastest = opts.pickFastest || pickFastest; // injectable for tests
  }

  /**
   * Start a background job. Returns immediately with the job id and the planned files.
   * @param {{ files: Array<{ urls: string[], filename?: string }>, destDir?: string, maxBytes?: number,
   *           preferFastest?: boolean }} spec
   * @returns {object} the initial public job snapshot (state "running")
   */
  start(spec) {
    const list = Array.isArray(spec.files) ? spec.files : [];
    if (!list.length) {
      const e = new Error("download_start: `files` must be a non-empty array.");
      e.code = "no_files";
      throw e;
    }
    const job = {
      job_id: randomUUID(),
      state: "running",
      created_at: new Date(this._now()).toISOString(),
      finished_at: null,
      dest_dir: spec.destDir || downloadDir(),
      _maxBytes: spec.maxBytes || envMaxBytesBackground(),
      _preferFastest: spec.preferFastest !== false,
      _concurrency: spec.concurrency || this._concurrency,
      _cancelled: false,
      _lastPersist: 0,
      files: list.map((f, index) => {
        const urls = (f.urls || []).filter((u) => typeof u === "string" && u);
        return {
          index,
          urls,
          filename: f.filename,
          state: urls.length ? "queued" : "failed",
          error: urls.length ? undefined : "no URL provided",
          code: urls.length ? undefined : "no_url",
          bytes: 0,
          total: null,
          speed_bps: 0,
          _ac: new AbortController()
        };
      })
    };
    this._jobs.set(job.job_id, job);
    job._promise = this._run(job).catch(() => {}); // floating: the caller does NOT await it
    return publicJob(job);
  }

  /** Snapshot one job, or a summary list of all jobs when no id is given. */
  status(jobId) {
    if (!jobId) {
      return {
        jobs: [...this._jobs.values()].map((j) => ({
          job_id: j.job_id,
          state: j.state,
          files: j.files.length,
          done: j.files.filter((f) => f.state === "done").length
        }))
      };
    }
    const job = this._jobs.get(jobId);
    if (!job) return { error: `No job ${jobId}.`, code: "no_job" };
    return publicJob(job);
  }

  /** Cancel a running job: abort in-flight transfers and drop their partials. */
  cancel(jobId) {
    const job = this._jobs.get(jobId);
    if (!job) return { error: `No job ${jobId}.`, code: "no_job" };
    job._cancelled = true;
    for (const f of job.files) {
      try {
        f._ac.abort();
      } catch {
        /* already settled */
      }
    }
    return publicJob(job);
  }

  /** Test/introspection helper: await a job's completion. */
  async wait(jobId) {
    const job = this._jobs.get(jobId);
    if (job?._promise) await job._promise;
    return this.status(jobId);
  }

  async _run(job) {
    const files = job.files.filter((f) => f.state === "queued");
    let idx = 0;
    const worker = async () => {
      for (;;) {
        if (job._cancelled) return;
        const i = idx++;
        if (i >= files.length) return;
        const file = files[i];
        if (job._cancelled) {
          file.state = "cancelled";
          continue;
        }
        await this._runFile(job, file);
        this._persist(job, true);
      }
    };
    const n = Math.max(1, Math.min(job._concurrency, files.length || 1));
    await Promise.all(Array.from({ length: n }, worker));

    const states = job.files.map((f) => f.state);
    job.state = job._cancelled
      ? "cancelled"
      : states.every((s) => s === "done")
        ? "done"
        : states.every((s) => s === "failed" || s === "cancelled")
          ? "failed"
          : "partial";
    job.finished_at = new Date(this._now()).toISOString();
    this._persist(job, true);
  }

  async _runFile(job, file) {
    try {
      file.state = "probing";
      this._persist(job, true);
      let chosen = file.urls[0];
      if (job._preferFastest && file.urls.length > 1) {
        try {
          const r = await this._pickFastest(file.urls, {
            deps: this._deps,
            now: this._now,
            signal: file._ac.signal
          });
          chosen = r.url;
          file.mirrors = r.ranked
            .filter((m) => m.ok)
            .map((m) => ({
              url: m.url,
              throughput_bps: m.throughput_bps,
              latency_ms: m.latency_ms,
              rank: m.rank,
              ...(m.size_mismatch ? { size_mismatch: true } : {})
            }));
        } catch {
          chosen = file.urls[0]; // all probes failed — try the first URL and let the real error show
        }
      }
      file.chosen_url = chosen;
      file.state = "downloading";
      this._persist(job, true);
      await this._streamFile(job, file, chosen);
      file.state = "done";
    } catch (e) {
      if (file._ac.signal.aborted || e?.name === "AbortError" || job._cancelled) {
        file.state = "cancelled";
        await this._cleanupPart(job, file);
      } else {
        file.state = "failed";
        file.error = e.message;
        file.code = e.code || "error";
      }
    }
  }

  async _streamFile(job, file, chosen) {
    const destDir = job.dest_dir;
    const maxBytes = job._maxBytes;
    const now = this._now;
    await mkdir(destDir, { recursive: true });

    // Stable `.part` name (URL/suggestion only, NO content-type) so a resume finds the same partial.
    const prelimName = deriveFilename({ suggested: file.filename, url: new URL(chosen) });
    const partPath = safeJoin(destDir, prelimName + ".part");
    file._partPath = partPath;
    let startBytes = existsSync(partPath) ? safeSize(partPath) : 0;

    const extraHeaders = startBytes > 0 ? { range: `bytes=${startBytes}-` } : undefined;
    const { res, finalUrl } = await openStream(chosen, {
      method: "GET",
      deps: this._deps,
      idleMs: this._idleMs,
      extraHeaders,
      signal: file._ac.signal
    });
    const status = res.statusCode || 0;

    let base = 0;
    let writeFlags = "w";
    let resumed = false;
    let total = null;
    if (status === 416) {
      // Range Not Satisfiable → the `.part` is already the whole file. Finalize it as-is.
      res.destroy();
      return this._finalize(job, file, {
        partPath,
        finalUrl,
        contentType: null,
        total: startBytes,
        runningHash: null
      });
    } else if (status === 206) {
      resumed = startBytes > 0;
      base = startBytes;
      writeFlags = startBytes > 0 ? "a" : "w";
      total = totalFromContentRange(res.headers["content-range"]);
    } else if (status === 200) {
      base = 0; // server ignored Range (or none asked): restart, truncating any stale `.part`
      writeFlags = "w";
      total = Number.isFinite(Number(res.headers["content-length"]))
        ? Number(res.headers["content-length"])
        : null;
    } else {
      res.destroy();
      await rm(partPath, { force: true }).catch(() => {}); // HTTP error is not resumable
      throw new DownloadHttpError(status, finalUrl.href);
    }

    if (Number.isFinite(total) && total > maxBytes) {
      res.destroy();
      await rm(partPath, { force: true }).catch(() => {});
      throw new DownloadSizeError(maxBytes, total);
    }
    if (Number.isFinite(total)) await assertDiskSpace(destDir, total - base); // keeps `.part` on throw

    const contentType =
      String(res.headers["content-type"] || "")
        .split(";")[0]
        .trim() || null;
    file.total = Number.isFinite(total) ? total : null;
    file.bytes = base;

    const hash = createHash("sha256");
    let session = 0;
    let lastTick = now();
    let lastBytes = base;
    const onTick = () => this._persist(job);
    const meter = new Transform({
      transform(chunk, _enc, cb) {
        session += chunk.length;
        const cur = base + session;
        if (cur > maxBytes) return cb(new DownloadSizeError(maxBytes, cur));
        hash.update(chunk);
        file.bytes = cur;
        const t = now();
        if (t - lastTick >= 500) {
          file.speed_bps = Math.round(((cur - lastBytes) / (t - lastTick)) * 1000);
          lastTick = t;
          lastBytes = cur;
          onTick();
        }
        cb(null, chunk);
      }
    });

    await pipeline(res, meter, createWriteStream(partPath, { flags: writeFlags }), {
      signal: file._ac.signal
    });

    // A resumed transfer's running hash misses the pre-existing bytes → recompute from the file.
    return this._finalize(job, file, {
      partPath,
      finalUrl,
      contentType,
      total: base + session,
      runningHash: resumed && base > 0 ? null : hash
    });
  }

  async _finalize(job, file, { partPath, finalUrl, contentType, total, runningHash }) {
    const finalName = deriveFilename({ suggested: file.filename, url: finalUrl, contentType });
    const finalPath = resolveWithinRoot(job.dest_dir, finalName, this._deps.existsSync);
    await rename(partPath, finalPath);
    file.path = finalPath;
    file.filename = path.basename(finalPath);
    file.size_bytes = total;
    file.content_type = contentType;
    file.final_url = finalUrl.href;
    file.sha256 = runningHash ? runningHash.digest("hex") : await sha256OfFile(finalPath);
    file.speed_bps = 0;
  }

  async _cleanupPart(job, file) {
    if (file._partPath) await rm(file._partPath, { force: true }).catch(() => {});
  }

  /** Best-effort state-file write (audit + inspection). Throttled during progress; never throws. */
  _persist(job, force = false) {
    const t = this._now();
    if (!force && t - job._lastPersist < PROGRESS_PERSIST_MS) return;
    job._lastPersist = t;
    const snapshot = JSON.stringify(publicJob(job));
    mkdir(this._stateDir, { recursive: true })
      .then(() => writeFile(path.join(this._stateDir, `${job.job_id}.json`), snapshot))
      .catch(() => {});
  }
}

function safeSize(p) {
  try {
    return statSync(p).size;
  } catch {
    return 0;
  }
}

/** The process-wide manager used by the MCP server (tests construct their own with injected deps). */
export const defaultManager = new JobManager();
