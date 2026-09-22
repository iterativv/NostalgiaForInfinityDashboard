// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * SettingsSelect — clip-proof dropdown for settings forms.
 *
 * Carbon's `Dropdown` renders its option list inline, so inside a scrolling
 * `WidgetSettingsModal` the open list gets cropped by the dialog (the menu
 * cannot escape `overflow` clipping). A native `<select>` renders its popup
 * in the top layer and never clips — same value semantics, styled for the
 * dark terminal. Use this for every select inside settings modals.
 */
export function SettingsSelect({
  id,
  label,
  items,
  value,
  onChange,
}: {
  id: string
  label: string
  items: ReadonlyArray<{ readonly id: string; readonly text: string }>
  value: string
  onChange: (id: string) => void
}) {
  return (
    <div className="nfi-settings-select">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.text}
          </option>
        ))}
      </select>
    </div>
  )
}
