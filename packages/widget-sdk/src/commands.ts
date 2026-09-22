// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Command + sidebar-contribution contracts.
 *
 * Invariant: sidebar clicks, palette actions and keyboard shortcuts never
 * implement workspace behavior themselves — they resolve a `Command` and
 * call `run()`. All behavior lives in the workspace store, which applies
 * pure transformations from `operations.ts`.
 *
 * ```text
 * Sidebar ────────────┐
 *                     │
 * Command Palette ────┼──→ Command.run() → Workspace Store → pure op
 *                     │
 * Keyboard Shortcut ──┘
 * ```
 */

export interface Command {
  /** Stable id, e.g. `workspace.splitHorizontal`. */
  readonly id: string
  readonly title: string
  readonly category?: string
  /** Human-readable shortcut for palette/sidebar display (shell wires keys). */
  readonly shortcut?: string
  readonly run: () => void
}

export interface CommandRegistry {
  readonly registerCommand: (command: Command) => void
  readonly getCommand: (id: string) => Command | undefined
  readonly listCommands: () => ReadonlyArray<Command>
  /** Runs the command; returns false when the id is unknown. */
  readonly runCommand: (id: string) => boolean
}

export function createCommandRegistry(initial: ReadonlyArray<Command> = []): CommandRegistry {
  const entries = new Map<string, Command>()
  for (const command of initial) {
    entries.set(command.id, command)
  }
  return {
    registerCommand: (command) => {
      entries.set(command.id, command)
    },
    getCommand: (id) => entries.get(id),
    listCommands: () => [...entries.values()],
    runCommand: (id) => {
      const command = entries.get(id)
      if (!command) return false
      command.run()
      return true
    },
  }
}

/**
 * Declarative sidebar entry. The shell renders these; it never knows how
 * individual widgets work — an entry only references a command id, e.g. a
 * command that opens `development.inspector`.
 */
export interface SidebarContribution {
  readonly id: string
  readonly label: string
  /** Icon key resolved to a Carbon icon by the shell (SDK stays Carbon-free). */
  readonly icon: string
  readonly commandId: string
}
