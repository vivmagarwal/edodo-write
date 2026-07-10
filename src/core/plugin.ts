/**
 * Plugin resolution. `EdodoWrite` resolves `[corePreset(), ...options.plugins]`
 * ONCE at construction into flat, ordered registries. There is no runtime
 * (un)registration — dynamic plugin churn is where stale-menu and
 * half-torn-down-rule bugs live; re-create the editor to change the set.
 *
 * Failure philosophy:
 *   • Configuration mistakes (duplicate plugin names, duplicate command names
 *     or item ids, malformed key strings) THROW at construction, naming both
 *     offenders — never silently last-wins.
 *   • Runtime mistakes are ISOLATED: every plugin contribution runs inside a
 *     try/catch (`guard`); a throwing plugin logs and is skipped for that
 *     event. One bad plugin must not kill typing.
 */

import type {
  BlockInputRule, BlockMenuItem, CommandSpec, EdodoPlugin, InlineInputRule,
  KeyBinding, SlashItem, ToolbarItem, SanitizeOptions,
} from "./types.js";
import type { MarkedExtension } from "marked";
import type { SerializerExtension } from "./serialize.js";

const DEFAULT_PRIORITY = 100;
const CORE_PLUGIN_NAME = "core";

/**
 * Identity helper for plugin authors: type inference, upfront validation,
 * and a frozen object. The documented way to create a plugin.
 */
export function definePlugin(plugin: EdodoPlugin): EdodoPlugin {
  if (!plugin.name || !/^[a-z][a-z0-9-]*(:[a-z0-9-]+)?$/i.test(plugin.name)) {
    throw new Error(`[edodo-write] plugin name "${plugin.name}" must be a kebab-case identifier`);
  }
  for (const key of Object.keys(plugin.keymap ?? {})) parseKeyString(key, plugin.name);
  return Object.freeze({ ...plugin });
}

// ── Key strings ─────────────────────────────────────────────────────────────

export interface KeyDescriptor {
  mod: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  key: string; // lowercase for letters/digits; canonical for named keys
}

export function parseKeyString(spec: string, owner: string): KeyDescriptor {
  const parts = spec.split("-");
  const key = parts.pop();
  const d: KeyDescriptor = { mod: false, ctrl: false, alt: false, shift: false, key: "" };
  if (!key) throw new Error(`[edodo-write] plugin "${owner}": empty key string "${spec}"`);
  for (const part of parts) {
    switch (part.toLowerCase()) {
      case "mod": d.mod = true; break;
      case "ctrl": d.ctrl = true; break;
      case "alt": d.alt = true; break;
      case "shift": d.shift = true; break;
      default:
        throw new Error(`[edodo-write] plugin "${owner}": unknown modifier "${part}" in "${spec}"`);
    }
  }
  d.key = key.length === 1 ? key.toLowerCase() : key;
  return d;
}

export function matchesKey(d: KeyDescriptor, e: KeyboardEvent): boolean {
  const hasMod = e.metaKey || e.ctrlKey;
  if (d.mod) {
    if (!hasMod) return false;
  } else if (d.ctrl) {
    if (!e.ctrlKey || e.metaKey) return false;
  } else if (hasMod) {
    return false;
  }
  if (d.alt !== e.altKey) return false;
  if (d.shift !== e.shiftKey) return false;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (key === d.key) return true;
  // Shift+digit reports the shifted symbol in e.key ("&" for Shift+7 on US
  // layouts) — fall back to the physical digit key.
  if (/^\d$/.test(d.key) && e.code === `Digit${d.key}`) return true;
  return false;
}

// ── Resolved registries ─────────────────────────────────────────────────────

export interface RegisteredCommand {
  spec: CommandSpec<any>;
  plugin: string;
}

export interface ResolvedKeyBinding {
  descriptor: KeyDescriptor;
  binding: KeyBinding;
  plugin: string;
  priority: number;
  order: number;
}

export interface OwnedBlockRule extends BlockInputRule { plugin: string }
export interface OwnedInlineRule extends InlineInputRule { plugin: string }

export interface PluginRegistry {
  commands: Map<string, RegisteredCommand>;
  blockRules: OwnedBlockRule[];
  inlineRules: OwnedInlineRule[];
  keymap: ResolvedKeyBinding[];
  slashItems: SlashItem[];
  toolbarItems: ToolbarItem[];
  blockMenuItems: BlockMenuItem[];
  markedExtensions: MarkedExtension[];
  turndownExtensions: SerializerExtension[];
  sanitize: SanitizeOptions | undefined;
  plugins: EdodoPlugin[];
}

export function resolvePlugins(plugins: EdodoPlugin[], exclude: string[] = []): PluginRegistry {
  const excluded = new Set(exclude);
  const names = new Map<string, string>();
  const reg: PluginRegistry = {
    commands: new Map(),
    blockRules: [],
    inlineRules: [],
    keymap: [],
    slashItems: [],
    toolbarItems: [],
    blockMenuItems: [],
    markedExtensions: [],
    turndownExtensions: [],
    sanitize: undefined,
    plugins,
  };
  const itemIds = { slash: new Map<string, string>(), toolbar: new Map<string, string>(), blockMenu: new Map<string, string>() };
  let order = 0;

  for (const plugin of plugins) {
    if (names.has(plugin.name)) {
      throw new Error(`[edodo-write] duplicate plugin name "${plugin.name}"`);
    }
    names.set(plugin.name, plugin.name);
    const priority = plugin.priority ?? (plugin.name === CORE_PLUGIN_NAME ? 0 : DEFAULT_PRIORITY);
    const skip = (id: string) => excluded.has(id) && plugin.name === CORE_PLUGIN_NAME;

    for (const [name, spec] of Object.entries(plugin.commands ?? {})) {
      if (skip(name)) continue;
      const existing = reg.commands.get(name);
      if (existing) {
        throw new Error(
          `[edodo-write] command "${name}" registered by both "${existing.plugin}" and "${plugin.name}"`,
        );
      }
      reg.commands.set(name, { spec, plugin: plugin.name });
    }

    for (const rule of plugin.inputRules ?? []) {
      if (typeof rule.apply === "string" && skip(rule.apply)) continue;
      if (rule.kind === "block") reg.blockRules.push({ ...rule, plugin: plugin.name });
      else reg.inlineRules.push({ ...rule, plugin: plugin.name });
    }

    for (const [keySpec, binding] of Object.entries(plugin.keymap ?? {})) {
      if (typeof binding === "string" && skip(binding)) continue;
      reg.keymap.push({
        descriptor: parseKeyString(keySpec, plugin.name),
        binding,
        plugin: plugin.name,
        priority,
        order: order++,
      });
    }

    const collect = <T extends { id: string; command?: string }>(
      items: T[] | undefined, into: T[], seen: Map<string, string>, kind: string,
    ) => {
      for (const item of items ?? []) {
        if (skip(item.id) || (item.command && skip(item.command))) continue;
        const owner = seen.get(item.id);
        if (owner) {
          throw new Error(`[edodo-write] ${kind} item "${item.id}" registered by both "${owner}" and "${plugin.name}"`);
        }
        seen.set(item.id, plugin.name);
        into.push(item);
      }
    };
    collect(plugin.slashItems, reg.slashItems, itemIds.slash, "slash");
    collect(plugin.toolbarItems, reg.toolbarItems, itemIds.toolbar, "toolbar");
    collect(plugin.blockMenuItems, reg.blockMenuItems, itemIds.blockMenu, "block-menu");

    if (plugin.markdown?.marked) reg.markedExtensions.push(...plugin.markdown.marked);
    if (plugin.markdown?.turndown) reg.turndownExtensions.push(plugin.markdown.turndown);
    if (plugin.sanitize) {
      reg.sanitize = {
        tags: [...(reg.sanitize?.tags ?? []), ...(plugin.sanitize.tags ?? [])],
        attributes: { ...(reg.sanitize?.attributes ?? {}), ...(plugin.sanitize.attributes ?? {}) },
      };
    }
  }

  // Priority desc, then registration order — first handler that acts wins.
  reg.keymap.sort((a, b) => b.priority - a.priority || a.order - b.order);
  return reg;
}

/**
 * Run a plugin contribution with error isolation. A throwing plugin logs and
 * is skipped for this event — it never breaks typing.
 */
export function guard<T>(plugin: string, hook: string, fn: () => T): T | undefined {
  try {
    return fn();
  } catch (err) {
    console.error(`[edodo-write] plugin "${plugin}" failed in ${hook}:`, err);
    return undefined;
  }
}
