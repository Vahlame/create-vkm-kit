#!/usr/bin/env node
/**
 * Cursor `sessionStart` hook — injects the same vault map + reminders as the
 * Claude SessionStart hook, in Cursor's `additional_context` shape.
 *
 * Installed by create-vkm-kit (vkm-kit) into `~/.cursor/hooks/`.
 * Contract (Cursor hooks): print JSON `{ "additional_context": "<text>" }` on stdout.
 */
import { pathToFileURL } from "node:url";
import fs from "node:fs";
import {
  buildContext,
  modelChangeNotice,
  reminders
} from "./session-start-vault-context.mjs";
import { resetState } from "./cursor-session-state.mjs";

function resolveVault() {
  const fromArg = process.argv[2];
  if (fromArg && fromArg.trim()) return fromArg.trim();
  return (
    process.env.VKM_VAULT ||
    process.env.BASIC_MEMORY_HOME ||
    process.env.OBSIDIAN_MEMORY_VAULT ||
    ""
  );
}

export function main() {
  resetState();
  const vault = resolveVault();
  const lang = (process.argv[3] || "es").toLowerCase() === "en" ? "en" : "es";
  let sessionModel = null;
  try {
    const raw = fs.readFileSync(0, "utf8");
    if (raw.trim()) {
      const input = JSON.parse(raw);
      sessionModel = input?.model ?? input?.modelId ?? null;
    }
  } catch {
    /* no/invalid stdin — still inject reminders */
  }
  let additional_context;
  try {
    additional_context = buildContext(vault, lang) + modelChangeNotice(sessionModel, lang);
  } catch {
    additional_context = reminders(lang);
  }
  process.stdout.write(JSON.stringify({ additional_context, env: { VKM_VAULT: vault } }));
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  try {
    main();
  } catch {
    process.stdout.write(JSON.stringify({ additional_context: reminders("es") }));
  }
}
