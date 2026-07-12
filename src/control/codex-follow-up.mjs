import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const ERROR_LIMIT = 8 * 1024;
const RUN_TTL_MS = 10 * 60 * 1000;
const MAX_RUNS = 100;

export class FollowUpControllerError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function createCodexFollowUpController({
  codexBin,
  spawnProcess = spawn,
  env = process.env,
  now = () => new Date(),
  randomId = randomUUID
}) {
  const runs = new Map();
  const activeSessions = new Set();

  return {
    async submitFollowUp({ sessionId, sessionUuid, projectPath, prompt }) {
      cleanupRuns(runs, now);
      if (activeSessions.has(sessionId)) {
        throw new FollowUpControllerError("busy", "A follow-up is already running");
      }
      if (!reserveRunCapacity(runs)) {
        throw new FollowUpControllerError("capacity", "Too many follow-up runs are active");
      }

      const run = {
        id: randomId(),
        sessionId,
        status: "running",
        startedAt: now().toISOString()
      };
      runs.set(run.id, run);
      activeSessions.add(sessionId);

      let child;
      try {
        child = spawnProcess(
          codexBin,
          [
            "exec",
            "resume",
            "--json",
            "-c",
            'approval_policy="on-request"',
            "-c",
            'approvals_reviewer="auto_review"',
            sessionUuid,
            "-"
          ],
          {
            cwd: projectPath,
            env,
            shell: false,
            stdio: ["pipe", "pipe", "pipe"]
          }
        );
      } catch (error) {
        failRun(run, activeSessions, now, error);
        throw new FollowUpControllerError("spawn-unavailable", errorMessage(error));
      }

      let stderr = "";
      let outcome;
      let spawned = false;
      const lines = createInterface({ input: child.stdout });
      const handleStreamError = (error) => failRun(run, activeSessions, now, error);
      child.stdin.on("error", handleStreamError);
      child.stdout.on("error", handleStreamError);
      child.stderr.on("error", handleStreamError);
      lines.on("error", handleStreamError);
      lines.on("line", (line) => {
        try {
          const event = JSON.parse(line);
          if (event.type === "turn.completed") {
            outcome = { status: "complete" };
          } else if (event.type === "turn.failed" || event.type === "error") {
            outcome = { status: "failed", error: eventError(event) };
          }
        } catch {
          // Ignore non-JSON diagnostics; stderr is retained in bounded form.
        }
      });
      child.stderr.on("data", (chunk) => {
        stderr = bounded(`${stderr}${chunk.toString("utf8")}`);
      });

      const spawnedPromise = new Promise((resolve, reject) => {
        child.once("spawn", () => {
          spawned = true;
          child.stdin.end(prompt);
          resolve(publicRun(run));
        });
        child.once("error", (error) => {
          failRun(run, activeSessions, now, error);
          if (!spawned) {
            reject(new FollowUpControllerError("spawn-unavailable", errorMessage(error)));
          }
        });
      });

      child.once("close", (code) => {
        if (run.status !== "running") {
          return;
        }

        if (code === 0 && outcome?.status === "complete") {
          completeRun(run, activeSessions, now);
          return;
        }

        const detail = outcome?.error || stderr || `Codex exited with code ${code ?? "unknown"}`;
        failRun(run, activeSessions, now, new Error(detail));
      });

      return spawnedPromise;
    },

    getRun(runId) {
      cleanupRuns(runs, now);
      const run = runs.get(runId);
      return run ? publicRun(run) : null;
    },

    isSessionActive(sessionId) {
      return activeSessions.has(sessionId);
    }
  };
}

function completeRun(run, activeSessions, now) {
  run.status = "complete";
  run.completedAt = now().toISOString();
  activeSessions.delete(run.sessionId);
}

function failRun(run, activeSessions, now, error) {
  if (run.status !== "running") {
    return;
  }
  run.status = "failed";
  run.completedAt = now().toISOString();
  run.error = bounded(errorMessage(error));
  activeSessions.delete(run.sessionId);
}

function publicRun(run) {
  return { ...run };
}

function eventError(event) {
  return errorMessage(event.error?.message ?? event.error ?? event.message ?? "Codex turn failed");
}

function errorMessage(error) {
  return bounded(error instanceof Error ? error.message : String(error));
}

function bounded(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .slice(-ERROR_LIMIT);
}

function cleanupRuns(runs, now) {
  const cutoff = now().getTime() - RUN_TTL_MS;
  for (const [id, run] of runs) {
    const completedAt = run.completedAt ? Date.parse(run.completedAt) : NaN;
    if (Number.isFinite(completedAt) && completedAt < cutoff) {
      runs.delete(id);
    }
  }
}

function reserveRunCapacity(runs) {
  if (runs.size < MAX_RUNS) {
    return true;
  }

  for (const [id, run] of runs) {
    if (run.status !== "running") {
      runs.delete(id);
      if (runs.size < MAX_RUNS) {
        return true;
      }
    }
  }
  return runs.size < MAX_RUNS;
}
