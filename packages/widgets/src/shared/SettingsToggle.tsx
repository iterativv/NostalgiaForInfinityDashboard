// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Toggle } from "@carbon/react"

/** Single persisted boolean in a widget's ⚙ settings panel. */
export function SettingsToggle({
  label,
  toggled,
  onToggle,
  id,
}: {
  label: string
  toggled: boolean
  onToggle: (v: boolean) => void
  id: string
}) {
  return <Toggle id={id} labelText={label} toggled={toggled} onToggle={onToggle} size="sm" />
}
