# cubeui controls

Read [SKILL.md](SKILL.md) first. These are the controls, not the shells: each one is a real
control with a real accessible name, usable on its own or inside a `FormField`. Every one of them
has a bound counterpart in [forms.md](forms.md) — reach for that inside a TanStack form, and for
these in a filter bar, a toolbar, or a plain `useState` screen.

**Web only**, except the icons, the segmented control, `DatePicker`, `DateRangePicker`, `DateTimeInput`, `ColorPicker` and the
colour display parts, the removable badge, the spinner, the alert, the menu, the option select, the theme picker, the copy button, the icon in an input, the search box, the progress bar, the multi-select, and the file picker (its native half only draws the zone), which each say so. Everything else here is a DOM
component with no React Native half, so it does not install in an Expo project. `SKILL.md`'s last
section is the native set.

## Icons

Import icons from `@/components/ui/icons` (`@cubeui/icons`), not from `lucide-react` or
`lucide-react-native` directly. It is the same lucide names on both halves: a plain re-export on
the web, where an `<svg>` takes `currentColor` from its container, and styled wrappers on native,
where nothing inherits and a container like `Button` publishes its text colour for the icons
below it. A component that takes an icon as a prop types it as `IconComponent`.

**A glyph the set does not ship is wrapped in the app, with the exported `icon`.** Do not copy the
native wrapper, and do not add to `icons.tsx` — the next `shadcn add` of `@cubeui/icons`
overwrites it. Write the app's own pair of files, one line per glyph, beside each other so Metro
picks the `.web.tsx` on web the same way it does for `icons`:

```tsx
// components/app-icons.tsx — native: the per-icon path, since Metro does not tree-shake
import TagSource from "lucide-react-native/icons/tag";
import { icon } from "@/components/ui/icons";

export const Tag = icon(TagSource);
```

```tsx
// components/app-icons.web.tsx — web: the barrel, from lucide-react
import { Tag as TagSource } from "lucide-react";
import { icon } from "@/components/ui/icons";

export const Tag = icon(TagSource);
```

On native `icon` is the same wrapper every icon in the set goes through — `className` sizing, the
`text-foreground` floor and `IconClassContext` — so the app's glyph follows a `Button`'s colour
like the rest. On web it hands the glyph back unchanged, since an `<svg>` already inherits
`currentColor`; it exists so both files read the same. Keep the two files' names in step, as
`icons` does: TypeScript only resolves the native one. A DOM-only app needs only the second file,
or can import the glyph from `lucide-react` directly. `IconProps` is exported beside `icon` for a
component that forwards an icon's props.

A tab can carry an icon too: `<TabsTrigger value="board"><Calendar /> Board</TabsTrigger>`.
The trigger lays its children out in a row, puts only the text in a `<Text>`, and hands the icon
the tab's active or inactive colour on both halves — do not colour it yourself, and do not build a
segmented control to get one.

Name the tablist when no visible heading does: `<TabsList aria-label="Project view">`, or
`aria-labelledby` pointed at the heading's id (`nativeID` on device). It is on the shared contract, so one call site names
it on both halves; a screen reader announces it on entering the tabs.

## Segmented control

A row of three or four pills, one current, that switches a view or a period rather than opening a
panel (that is `Tabs`). `@cubeui/segmented`, on both platforms:

```tsx
<SegmentedGroup aria-label="Scale view" value={view} onValueChange={setView}>
  <SegmentedButton value="relative">Relative</SegmentedButton>
  <SegmentedButton value="parallel">Parallel</SegmentedButton>
</SegmentedGroup>
```

**Put the pills in a `SegmentedGroup`; do not write the row yourself.** The group is the
`role="group"` that says what the pills choose between. Without it, a screen reader hears
"Relative, toggle button, pressed" and nothing about what Relative was chosen from. Name it with
`aria-label`, or with `aria-labelledby` pointed at a visible heading (`nativeID` on device). Inside
a `FormField`, pass `asGroup`, which does that for you (see [forms.md](forms.md)).

- **`value` and `onValueChange` go on the group**, and each pill takes its own `value`. The group
  works out which pill is pressed, and a press calls `onValueChange` with that pill's `value`. The
  value is the caller's: the group keeps no state.
- **`active` still works.** A pill given `active` uses it instead of the group's `value`, so older
  call sites with `active={view === "relative"}` keep working inside a group. A pill's own
  `onPress` (`onClick` on the web) still fires after the group is told.
- **`variant`**: `framed`, the default, is an input-height box (`h-10`, a border,
  `bg-background`), so the control lines up beside a `Select` or an `Input`. `plain` is the pills
  alone, for a toolbar or a nav bar.
- The pills are toggle buttons with `aria-pressed`, not radios. For a choice that belongs in a
  form and reads as a list of options, use `RadioGroup`.
- A pill that navigates is a router link, not a `SegmentedButton`. Give the link
  `segmentedItemClass(active)` and put it in a `SegmentedGroup variant="plain"` for the name.

## Icon buttons

**Every icon-only button is an `ActionButton`.** Not a `Button` with an SVG in it.

```tsx
<ActionButton label="Delete workspace" variant="ghost" size="icon" onClick={remove}>
  <Trash2 />
</ActionButton>
```

`label` is required and is the accessible name. `title` is not a name — it is a hint, it is not
read in place of one, and it never appears on a touch device. Across these projects 78 of 134
icon buttons announce as "button".

**`disabled` here is not the HTML attribute.** It becomes `aria-disabled`, so the control keeps
its focus ring, its hover and its tooltip and refuses the press in the handler. That is
deliberate: `disabled:pointer-events-none` is why every `title="Empty the lane first"` in these
apps was unreadable on exactly the control it was explaining. Pass `hint` with the reason:

```tsx
<ActionButton label="Delete lane" hint="Empty the lane first" disabled={cards.length > 0}>
  <Trash2 />
</ActionButton>
```

`hint` replaces `label` in the tooltip; the accessible name stays `label` either way, and the
hint is read after it whether or not the tooltip is open — it is also an always-mounted
`sr-only` span, because a tooltip's text is in the DOM only while it is showing. Pass
`tooltip={false}` for a row that already explains itself, and `side` to move the tooltip.

**A root `TooltipProvider` does not reach these buttons.** `ActionButton` renders its own, and
a nested provider replaces the one above it rather than merging with it — so an app with
`<TooltipProvider delayDuration={300}>` at its root gets 300ms everywhere except here, where
the tooltip opens the instant the pointer crosses. Pass `delayDuration` (and
`skipDelayDuration`, which is what makes a toolbar of them feel like one control) to match it.
Radix offers no way to read the outer provider, so the number has to be said twice; a project
that minds should say it once in a wrapper.

**Both of these are `type="button"`, so neither submits the form it sits in.** You do not need
to write it at the call site, and you should not go back to a bare `<Button>` to avoid it. A
`<button>` with no type is a submit button, which is why an icon button beside a field used to
save the form as well as do its own job — and why Enter in that field pressed the trash, since
implicit submission goes to the first submit button in tree order and never through a click.
A form's real submit is `SubmitButton`. If you want one of these to submit, say `type="submit"`.

**`@cubeui/action-button` is on both halves**, with the same props and the one conversion every
pressable has: `onPress` on a device, `onClick` on the web.

```tsx
<ActionButton label="Delete lane" hint="Empty the lane first" disabled={cards.length > 0} onPress={remove}>
  <Trash2 />
</ActionButton>
```

- On device the tooltip opens on a **long press**, and a `disabled` one still hears it — that is
  the same reason `disabled` is `aria-disabled` on the web. TalkBack and VoiceOver announce the
  button as unavailable.
- A string `hint` is the button's accessibility hint, read after `label`. A `hint` that is a node
  is only the tooltip there; pass a string when it has to be heard.
- `delayDuration`, `skipDelayDuration`, `type` and `aria-describedby` are web only. A device has
  no hover to delay and no form to submit.
- Under react-native-web (an Expo app's web build) `Pressable` overwrites `aria-disabled` with its
  own `disabled`, so there a disabled `ActionButton` refuses the press and reads its hint but is
  not announced as unavailable. The compiled web half, which a DOM app installs, is not affected.

## Copy button

A button that puts a string on the clipboard is `CopyButton`, on both halves. Do not write the
`useState(copied)` and the `setTimeout(…, 1500)` again:

```tsx
<PropertyRow
  label="Endpoint"
  value={<Code>{url}</Code>}
  action={<CopyButton value={url} label="Copy endpoint URL" />}
/>

<View className="relative">
  <Code>{snippet}</Code>
  <CopyButton
    value={snippet}
    label="Copy snippet"
    className="absolute top-2 right-2"
    onError={() => toast.error("Could not copy. Select the text and copy it by hand.")}
  />
</View>
```

- It is an icon button: `Copy`, then `Check` for 1.5 seconds once the text is on the clipboard.
  The accessible name is `label` (default `Copy` — name what is copied when there is more than
  one) and `Copied` while the tick shows.
- `variant` and `size` go to the `Button` underneath; the defaults are `ghost` and `icon-sm`.
  `className` is the button's, for placing it.
- The tick appears only if the write happened. A refused write — an insecure origin, a denied
  permission — calls `onError` and leaves the button as it was; `onCopied` runs after a good one.
  The toast is yours to raise, from either.
- The web half writes with `navigator.clipboard`, and falls back to `execCommand("copy")` where
  that does not exist (plain http on a LAN address). The native half is `expo-clipboard`, which
  the native item installs; a DOM app installs nothing extra.
- It is `type="button"` on the web, so it never submits the form it sits in.
- Not an `ActionButton`, and it has no tooltip: the glyph is the universal one and the name is
  always set, which are the two things `ActionButton` exists to guarantee.

## Destructive buttons

```tsx
<ConfirmButton
  label="Delete lane"
  variant="ghost"
  size="icon"
  title="Delete this lane?"
  description="The lane takes its cards with it."
  onConfirm={() => deleteLane(id)}
>
  <Trash2 />
</ConfirmButton>
```

Do not build the `AlertDialog` by hand. There are 22 hand-written ones across these projects and
they disagree about the button order, the confirm's variant, and what Cancel is called.

**`description` is required, and it is not "This cannot be undone."** The dialog already implies
that, and it teaches nothing. Say what is lost: *the lane takes its cards with it*, *anything
using this key stops working, including the nightly sync*, *the members lose access to every
server in it*. If you cannot write that sentence, the confirm is probably not warranted.

`confirmLabel` names the verb — Delete (the default), Discard, Revoke, Remove, Reset. The action
is always destructive; a confirm that is *not* destructive is a question, and a question is
`DialogLayout`.

Everything `ActionButton` takes, `ConfirmButton` takes: `hint`, `disabled`, `variant`, `size`. A
disabled `ConfirmButton` does not open the dialog.

**`@cubeui/confirm-button` is on both halves**, with the same props. The press opens the question,
so it takes neither `onPress` nor `onClick`; `onConfirm` is the one that acts. The dialog is
`ConfirmDialog`, the one `confirm()` raises, so the three draw the same card: an `alertdialog`
with Cancel first and the destructive verb last, no corner close, and a press beside it that does
not answer it. On device the back button is Cancel, and the trigger's tooltip is `ActionButton`'s
long press.

### Type the name to confirm

For a delete that is big and cannot be undone — a whole folder of notes, a workspace, a
repository — pass `requireText`, and the dialog asks for the name before it acts:

```tsx
<ConfirmButton
  label="Delete folder"
  title="Delete this folder?"
  description="Its 214 notes go with it, and so does their history."
  requireText={folder.name}
  requireTextLabel={<>Type <strong>{folder.name}</strong> to delete it</>}
  onConfirm={() => deleteFolder(folder.id)}
>
  <Trash2 />
</ConfirmButton>
```

It is the same prop on all three, so a call site moves between them unchanged:
`<ConfirmDialog requireText={…} />` and `confirm({ …, requireText: folder.name })` on both halves.

- A labelled input sits under the description, and the destructive button stays **disabled until
  the input holds `requireText` exactly** — case and spaces count, nothing is trimmed.
- **Enter confirms only when it matches.** Enter on a wrong value does nothing.
- The input is **empty each time the dialog opens**: the name is typed once per delete.
- `requireTextLabel` is the label, and defaults to "Type **{requireText}** to confirm". Pass
  one to say the verb. It is the input's accessible name, so keep the name in it.

Do not build this from `DialogLayout`, an `Input` and a disabled `Button`. Save it for the rare
delete that earns it: asking for a typed name on every row teaches people to type without
reading, and then it protects nothing.

## Menu

**A popover of actions is a `Menu`. Do not hand-build `menuitem` rows in a `Popover`.** A
`Pressable role="menuitem"` in a popover has no `role="menu"` around it, no arrow keys, does not
put focus back on the trigger, and its `onSelect` has to close the popover itself. `@cubeui/menu`,
on both platforms:

```tsx
<Menu>
  <MenuTrigger asChild>
    <Button variant="outline">Lane</Button>
  </MenuTrigger>
  <MenuContent align="end">
    <MenuItem icon={<Pencil />} label="Rename" onSelect={startRename} />
    <MenuItem icon={<ArrowLeft />} label="Move left" disabled={first} onSelect={moveLeft} />
    <MenuSeparator />
    <MenuItem icon={<Trash2 />} label="Delete" destructive onSelect={remove} />
  </MenuContent>
</Menu>
```

- **An icon-only trigger** is an `ActionButton` on the web (see [Icon buttons](#icon-buttons)) and
  a `Button` with an `aria-label` on device, both under `MenuTrigger asChild`.
- **The menu closes itself when a row is chosen.** Do not hold `open` to close it from
  `onSelect`. `open` / `onOpenChange` / `defaultOpen` are there if you need them, as on `Popover`.
- **`MenuItem` takes props, not children**: `label` (the text, and what typeahead matches),
  `icon`, `trailing` (a shortcut or a count; a string is drawn muted), `destructive`, `disabled`,
  `onSelect`, and `link` or `href` for a row that navigates. The icon takes the row's colour —
  `text-destructive` on a destructive row.
- **A row that goes somewhere is a link, not an `onSelect` that navigates.** Hand it the router's
  `Link` as an element with no children, `link`, and the row is drawn inside it — on the web the
  menu item *is* the router's `<a>`, so hovering or arrowing onto it reaches the link's own
  handlers and a router that preloads on intent does, and Enter or a click follows it and closes
  the menu:

  ```tsx
  import { Link } from "@tanstack/react-router";

  <MenuItem
    icon={<ArrowRight />}
    label="Open"
    link={<Link to="/projects/$id" params={{ id }} preload="intent" />}
  />
  <MenuItem label="Help" href="https://example.com/help" />
  ```

  Any router's link that renders an `<a>` and forwards its ref fits: React Router's
  `<Link to prefetch="intent" />`, Next's `<Link href />`. `href` alone is a plain `<a href>`, for
  a URL no router owns. The row looks exactly like the others, `onSelect` still runs first, and a
  `disabled` row renders no link at all, so nothing follows it. It is `link={…}` and not
  `<Link asChild><MenuItem /></Link>` as for `SidebarNavItem`: a menu handed the router's click
  would see it cancel the browser's navigation and take that as "keep the menu open". On device,
  `link` takes the row `asChild` — expo-router's `<Link href="/x" />` — and navigates beside
  `onSelect`; `href` alone there only runs `onSelect`, because there is no URL to open.
- **A row that deletes is `destructive`, and still goes through a confirm** if the loss is real:
  open a `ConfirmDialog` from its `onSelect`.
- On the web it is radix `DropdownMenu`: arrow keys, Home/End, typeahead, focus back on the
  trigger. On device it is the popover's centred sheet with `role="menu"`; focus goes back to the
  trigger as an accessibility event. Pass `aria-label` on `MenuContent` when the trigger has no
  text — radix names the web menu after the trigger, native has nothing to point at.
- **A row whose action moves focus is `focusesElsewhere`** — a row that reveals a field and
  focuses it. Without it the menu hands focus back to its trigger after it closes, and the field
  loses the focus it was just given. It covers that row's close only: Escape, a click outside and
  the other rows still return focus.
  `<MenuItem label="Add note" focusesElsewhere onSelect={showNoteField} />`, on both halves.
- **A Rename row opens a form** — a `FormDialog` with the name in a field and a Save button —
  not a text that turns into an input where it sits. See [No inline edits](SKILL.md#no-inline-edits).
- **A toggle list is `MenuCheckboxItem`** — labels on a todo, columns shown in a table, anything
  on or off, several at once. Do not hand-build `role="checkbox"` rows in a `Popover`, and do not
  fake one with a `MenuItem` and a trailing `<Check />`:

  ```tsx
  <MenuContent>
    {labels.map((l) => (
      <MenuCheckboxItem
        key={l.id}
        icon={<ColorDot color={l.color} />}
        label={l.name}
        checked={attached.has(l.id)}
        onCheckedChange={(on) => setAttached(l.id, on)}
      />
    ))}
  </MenuContent>
  ```

  It takes `MenuItem`'s row — `icon`, `label`, `trailing`, `disabled` — plus `checked` and
  `onCheckedChange`, and draws the ✓ itself at the far edge. **The menu stays open** when one is
  toggled, so a list is set in one go; Escape or a press outside closes it. It has no `onSelect`
  and no `destructive`: a setting is not an action.
- **One of N is `MenuRadioGroup` and `MenuRadioItem`** — a filter, a sort order:

  ```tsx
  <MenuRadioGroup value={sort} onValueChange={setSort}>
    <MenuRadioItem value="due" label="Due date" />
    <MenuRadioItem value="created" label="Created" />
  </MenuRadioGroup>
  ```

  The group holds `value` and `onValueChange`; each row takes `value` and the same row props.
  **Choosing a radio row closes the menu**, as radix does on the web and the native half matches:
  a one-of-N choice is done once it is made. Checkbox and radio rows mix with `MenuItem`s and
  `MenuSeparator`s in one `MenuContent`; pass the group an `aria-label` when there is more than
  one.
- The toggle rows are `menuitemcheckbox` / `menuitemradio` with `aria-checked`, on the web and in
  an Expo web app. On device React Native has no such role, so they are `checkbox` / `radio`,
  which is what makes a screen reader say "checked".
- A popover that is a small form or a note, not a list of actions, stays a `Popover`. Its Done
  button is `PopoverClose asChild`, not a handler that sets `open` to `false`.
- **A `Button` under `PopoverTrigger asChild` or `DialogTrigger asChild` opens it by itself**, on
  every half, Expo web included — leave the popover uncontrolled. Do not hold `open` only so the
  button can `onPress={() => setOpen(!open)}`; the `Button` hands the trigger's click on from its
  own press. The same goes for `PopoverClose asChild` and `DialogClose asChild`.
- A value chosen from a list is `Select` or `OptionSelect`, not a menu. `MenuRadioGroup` is for a
  view setting that lives behind a menu button — a filter, a sort — not for a form's value.

## Option select

```tsx
<OptionSelect options={LISTS} value={list} onValueChange={setList} placeholder="Choose one" />
```

`options` is `{ value, label, group?, className? }[]`, plus `{ separator: true }` for a rule and
`{ note }` for a row that is not a choice — the same array
`SelectField` takes, because `SelectField` renders this. Reach for it in a filter bar, a toolbar,
or a `useState` screen; inside a TanStack form use `SelectField` and never wire this by hand.

**It is not shadcn's `Select`, and it is not called that.** The primitive at
`@/components/ui/select` takes children; this takes `options`. It shipped as `Select` for one
day and could not keep the name: the shadcn CLI resolves a cross-item import by the source
file's basename, so two files called `select.tsx` in one install sent `app-form`'s import to the
primitive and broke the install.

- **On both halves.** Radix's listbox under the trigger on the web; the `Select` sheet on device,
  in an Expo app, with the same `options`, groups, separators and notes. Same import,
  `@/components/option-select`, on both.
- The trigger is what carries the wiring. The `Select` root renders nothing, so an `id` or an
  `aria-invalid` put on it goes nowhere — this takes the rest of the trigger's props (every
  `<button>` prop on the web; `id`, the `aria-*` props and `onBlur` on device) and spreads them on
  the trigger, which is why it drops straight into `FormField`'s **function form**:
  `control={(wired) => <OptionSelect {...wired} options={…} … />}`.
- Full width by default, because a column of selects that each shrink to their longest option is
  ragged. Pass `className="w-40"` for a toolbar; the later width wins.
- `contentClassName` is the dropdown's class. `className` is the trigger's, which is the control.
- `className` **on an option** is the row's, on the `SelectItem`. Reach for it when the values are
  identifiers rather than prose — model ids, SHA prefixes, file paths are `font-mono`. Wrapping
  the label in a `<span className="font-mono">` styles the text and leaves the row's padding,
  tick and highlight in the body face.

An option that is not a peer of the others says so in the array rather than in its own label:

```tsx
<OptionSelect
  options={[
    { value: "stay", label: "Stay here" },
    ...lanes.map((lane) => ({ value: lane.id, label: lane.name, group: "Lanes" })),
    { separator: true },
    { value: "archive", label: "Archive it" },
  ]}
  value={destination}
  onValueChange={setDestination}
/>
```

Drawn in the order given, never sorted — a board's lanes are ordered and alphabetical would be
wrong. A flat `{ value, label }[]` draws flat.

### A menu that fills when it opens

A list the server owns should not be fetched on mount: a form of twenty fields would ask for
eighteen lists nobody opens. `onOpenChange` is what makes that possible, and `{ note }` is where
the menu says it is still working.

```tsx
const [opened, setOpened] = useState(false);
const models = useQuery({ queryKey: ["models", endpoint], queryFn: fetchModels, enabled: opened });

<OptionSelect
  value={model}
  onValueChange={setModel}
  onOpenChange={setOpened}
  placeholder="Choose a model"
  options={[
    ...(models.data ?? []).map((m) => ({ value: m.id, label: m.id, className: "font-mono" })),
    ...(models.isFetching && !models.data ? [{ note: "Loading…" }] : []),
    ...(models.error ? [{ note: models.error.message, className: "text-destructive" }] : []),
  ]}
/>
```

- `onOpenChange` is the root's, so it is a prop here rather than something spread on the trigger.
  Pass it alone to be told; pass `open` with it to drive the menu yourself. The `select` primitive
  underneath takes the same pair, on both platforms.
- **A note is not a disabled option.** That is the workaround every hand-written version reaches
  for, and it is a row the keyboard walks onto and a reader hears as a choice they may not have.
  The row is `aria-hidden` and the words are announced from a `role="status"` region beside the
  control — unreachable, and read out when it appears, which is the case exactly, since the menu
  opens before the list exists.
- `SelectField` takes `onOpenChange` too, so a fetched list inside a form does not have to drop
  to `FormField`'s function form to get one word through.

## Command

A search box over a list of rows that filters as you type: shadcn's `Command` parts, on both
halves, at `components/ui/command`. `MultiSelect` is built on it, and it is what to reach for when
a picker or a palette needs a list that is not a tag picker.

```tsx
<Command label="Search projects">
  <CommandInput value={search} onValueChange={setSearch} placeholder="Search…" />
  <CommandList>
    <CommandEmpty>No projects.</CommandEmpty>
    <CommandGroup heading="Recent">
      {recent.map((p) => (
        <CommandItem key={p.id} value={p.name} keywords={[p.slug]} onSelect={() => open(p.id)}>
          {p.name}
          <CommandShortcut>{p.key}</CommandShortcut>
        </CommandItem>
      ))}
    </CommandGroup>
  </CommandList>
</Command>
```

- **The web half is cmdk**, so it keeps a highlighted row, arrow keys and Enter, and ranks by a
  fuzzy score. **The native half is its own list**, because cmdk has no React Native build: a
  search `Input` over pressable rows, and a row is chosen by pressing it. There is no highlight on
  device, so cmdk's `value`, `onValueChange`, `loop` and `vimBindings` on `Command` are web only.
- **The native default filter wants every typed word**, in any order and any case, and keeps the
  list in the order you wrote it; cmdk's fuzzy scorer re-sorts. Pass `filter` — cmdk's
  `(value, search, keywords) => number` — and both halves give the same answer.
  `matchesEveryWord` from `@/components/ui/command-base` is the native default, to hand the web
  half too.
- **Give `CommandItem` a `value`** whenever the row holds more than its name. Without one, cmdk
  matches the row's `textContent` and native its text children, and both include a
  `CommandShortcut` or a badge in what is searched and handed to `onSelect`.
- `label` on `Command` names the search box, `label` on `CommandList` the list (default
  "Suggestions"). `forceMount` keeps a group or a row drawn through the filter — a "Create …" row.
- `CommandDialog` is the palette in a `Dialog`, on both halves; `title` and `description` name it
  and are not drawn.

## Multi-select

A tag picker: a trigger showing what is chosen, a searchable list behind it. **On both halves**,
at `components/multi-select`, over `Popover`, `Command` and `Badge`.

```tsx
<MultiSelect
  options={TAGS}          // { value, label, keywords?, color?, disabled?, hint?, meta?, group? }[]
  value={tags}
  onValueChange={setTags}
  placeholder="No tags"
  onCreateOption={(name) => createTag(name)}
/>
```

- `searchable` is on by default and `keywords` widen what a search matches beyond the label.
- `onCreateOption` is what turns it into a combobox: given it, a search that matches nothing
  offers to create. Without it, a search that matches nothing says `emptyMessage`.
- `maxDisplay` caps the chips on the trigger and the rest become a count.
- `color` on an option draws a dot, and the tick on a chosen swatch picks its own contrast.
- **`hint` on an option says why it is the way it is** — most often why it is `disabled`. Drawn
  under the label and read after it, never as part of the name. A disabled row fires no hover,
  so a tooltip there is text nobody can reach, and greyed out on its own reads as a bug in the
  picker: "waiting on this would close a loop", "already applied by a rule", "not on your plan".
  Same argument as `ActionButton`'s `hint`.
- **`meta` on an option is the end of the row** — a status badge, a count, a date. Read after the
  name, never as part of it, and never on the chip: the chip is the label and stays a string. Do
  not reach for `color` for this. That is the chip's colour, and pointing it at a status mints a
  second colour vocabulary beside the app's own.
- **`group` on an option is a heading over the rows that share it.** Drawn in the order given,
  not sorted — a board's lanes are ordered and alphabetical would be wrong. The heading is
  searched along with the row, so typing a lane's name still finds the cards in it, and a group
  whose rows are all filtered out hides itself.

`label` is still the row, the chip and what the search matches, so anything that is not the name
goes in one of those three rather than into the label. `"Fix billing (archived)"` is a row saying
its status by having it typed into its name, and it says it on the chip too.

Its trigger is a real control that takes an `id` and the `aria-*` props, which is why it works
inside a `FormField` — but pass them through the **function form** of `control`, since its root
is a `Popover`. `MultiSelectField` already does.

- **On the web** the list is radix's popover over cmdk: portalled, the width of the trigger,
  arrow keys and Enter, and the create row pinned to the bottom of a long list.
- **On device** the trigger opens `Popover`'s native sheet over `Command`'s native list, and a
  row is chosen by pressing it. Every chip on the trigger is also removable with its ✕ — a
  `Badge` with `onRemove` — since there is no keyboard to reopen the list and untick it with.
  The search matches every word on both halves (`matchesEveryWord`), so the same typing finds the
  same rows.
- `MultiSelectField`, the bound one, is still web only.

## Date and date range

```tsx
<DatePicker value={dueAt} onValueChange={setDueAt} showTime />
<DateRangePicker value={window} onValueChange={setWindow} numberOfMonths={2} />
```

**On both halves**, from `@cubeui/date-picker` (it installs to `components/date-picker`). The
web half is compiled from the React Native source and draws react-day-picker, as it always did; on
device the popover is a centred sheet and the months stack.

- `showTime` adds a time input inside the popover, which stays open after a day is picked so the
  time can follow. A first pick is the day at midnight; picking a new day keeps the value's clock.
- `format` is a `date-fns` pattern for the trigger's text; `disabledDates` is passed to the
  calendar. `calendarProps` takes the calendar's shared props (`startMonth`, `weekStartsOn`,
  `defaultMonth`) on both halves, and on the web the rest of react-day-picker's too.
- `clearable` (on by default) puts a clear in the popover, and clearing sets `null`.
- The range picker closes on the second press after it opens, so the first press starts a range
  rather than ending one. Its value is a `DateRange` (`{ from, to? }`), exported beside it.
- The trigger is a button, which is labelable, so `htmlFor` works on the web — but the `aria-*`
  props still need the function form of `control`. `aria-describedby`, `aria-invalid` and
  `aria-required` are web only.
- `combineDateAndTime(day, clock)` and `setTime(day, "14:30")` are exported for the same
  arithmetic at a call site.

`DatePicker` owns a full-width trigger and puts its time box in the popover. The other date field
on both halves is `@cubeui/date-time-input` — the time box beside the trigger, and a date and a
time as one `Date` by default:

```tsx
<DateTimeInput value={startsAt} onChange={setStartsAt} />
```

The date comes from a `Calendar` in a `Popover` and the time from an `Input type="time"`, and the
two always commit one `Date` back — a caller never reassembles one. Picking a new day keeps the
clock.

Two props turn it into the optional, date-only field an Expo app needs for a due date:

```tsx
<DateTimeInput clearable mode="date" value={dueOn} onChange={setDueOn} placeholder="No due date" />
```

- `mode="date"` drops the time box, and a picked day is committed at local midnight.
- `clearable` is what lets the value be `null`: the trigger reads `placeholder` while it is, and a
  Clear row in the popover commits `null`. It is also what puts `null` in the types — without it
  `value` is `Date` and `onChange` is `(next: Date) => void`, so a caller holding `Date | null`
  has to say `clearable`. In `"datetime"` mode the time box waits, disabled, until a date is set.
- It takes `onChange`, not `onValueChange` — it predates the vocabulary, and renaming it would
  break every caller.

Name it the way a form names any control. `aria-labelledby` and `aria-label` name the trigger by
the field **and** the date, so a screen reader hears "Due, September 15th, 2026" rather than just
"Due"; in `"datetime"` mode the time box is named after the field too, so a form with a start and
an end does not have two boxes called "Time":

```tsx
<Label id="starts-label">Starts</Label>                       {/* both halves */}
<DateTimeInput aria-labelledby="starts-label" value={startsAt} onChange={setStartsAt} />
{/* trigger "Starts September 3rd, 2026", time box "Starts time" */}

<DateTimeInput aria-label="Ends" value={endsAt} onChange={setEndsAt} />
{/* trigger "Ends, September 3rd, 2026", time box "Ends, time" */}

<DateTimeInput aria-label="Due" clearable mode="date" placeholder="No due date" value={null} … />
{/* trigger "Due, No due date" — the placeholder stands in for the date */}

<FieldLabel htmlFor="due">Due</FieldLabel>                  {/* web only, and loses the date */}
<DateTimeInput id="due" clearable mode="date" value={dueOn} onChange={setDueOn} />
{/* trigger "Due" — the date is only its text */}
```

- **Prefer `aria-labelledby` to `htmlFor`.** A `<label for>` replaces a button's contents as its
  name, so the trigger is just "Due" and the date is not in it. The component cannot fix that from
  inside: it never sees the label's id, and pointing the trigger at itself puts the date in the
  name in Chromium but doubles it when no label exists, and Playwright's name engine drops the
  label instead. Give the `FieldLabel` an `id` and pass that as
  `aria-labelledby`; `id` still makes the trigger a target for a label that has nothing better.
- `htmlFor` names the trigger only — a label points at one control — so the time box stays
  "Time". Another reason a `mode="datetime"` field takes `aria-labelledby` (or `aria-label`).
- `htmlFor` is web only: the native `Label` has nothing to associate. `Label id` is on both
  halves, so `aria-labelledby` is the one that works everywhere; on device React Native takes the
  `id` as a `nativeID`, and iOS reads no reference at all, so pass `aria-label` when VoiceOver has
  to hear the name — it is composed with the date on device too.
- With no name given, the trigger is read by its text — the date or the placeholder — and the
  time box is "Time", as before.
- In a form, `DateTimeField` (`@cubeui/date-time-field`) does the `aria-labelledby` wiring for
  you — see [forms.md](forms.md#on-react-native).

`DatePicker` is the richer one — `format`, `disabledDates`, `calendarProps`, a range picker, and
a `FormField`'s `aria-*` on the trigger — and takes `onValueChange`.

## Progress

```tsx
<Progress value={done} max={turns} label="Re-embedding progress" valueLabel={`${done} of ${turns} turns`} />
<Progress value={job.progress * 100} label={`${job.name} upload`} />
```

`@cubeui/progress`, on both halves, for a bar showing how much of something is done — an upload,
a re-embed, a context window filling. It is one self-closing element: do not draw a track `div`
with a filled `div` and a `style.width` inside it.

- `value` is shadcn's: 0 to `max`, and `max` is 100 by default, so a percentage needs nothing
  else. It is clamped to `[0, max]`, so an overshoot draws a full bar, not a longer one.
- It is `role="progressbar"` with `aria-valuemin`, `aria-valuemax` and `aria-valuenow`. `label`
  is its accessible name; give one, since a bar with no name is read as "progress bar, 40%".
  `aria-label` works too, so a shadcn call site ports unchanged.
- `valueLabel` is the value in words, read instead of the number ("1,204 of 5,880 turns"). Leave
  it out when the percentage is what the number means.
- No `value` (or `null`) is indeterminate: drawn empty and announced with no value. It does not
  animate. A wait with no known end wants a [`Spinner`](#spinner), not an empty bar.
- `className` is the track (`h-1.5` for a thinner one); `indicatorClassName` is the filled part
  (`bg-destructive` for a context window nearly full). Colours are tokens, as everywhere.
- A bar of several coloured segments (a breakdown, a stacked share) is not a progress bar and not
  this component.

## Colour

```tsx
<ColorPicker value={color} onValueChange={setColor} clearable />
```

- It is drawn inline, not in a popover: a row of swatches over a hex field, one source for both
  platforms. `<input type="color">` has no native counterpart, so there is no OS colour well.
- The value is a hex string, `#rgb` or `#rrggbb`; `null` and `""` both mean no colour.
  `normalizeHex` and `isHexColor` are exported for a caller that validates its own — the hex
  field reports what is typed as it is typed, so validating is the caller's.
- `onValueChange` and `onChange` are the same callback under two names, and `swatches` and
  `colors` the same list; the default is 16 Tailwind 500s. The swatch row is a `radiogroup` of
  radios, each named by its hex, with a tick drawn in `readableTextColor` of the swatch.
- `clearable` (off by default) draws a Clear button, labelled `clearLabel`, that commits `""`.
- `placeholder` is the hex field's; `hexLabel` names the hex field for a screen reader (web
  only); `swatchesLabel` or `aria-label` names the swatch row. `disabled` blocks all of it, and
  `contentClassName` reaches the swatch row.
- `popoverLabel` and `customLabel` are accepted from the popover picker's API and ignored —
  there is no popover to name and no colour well to label.
- `id` goes to the hex field and the `aria-*` props to the swatch row, so a field's function-form
  `control` can spread onto it.

Showing a colour the user picked is three small items, all on both halves:

```tsx
<ColorDot color={tag.color} label={tag.name} size="sm" />
<Card accentColor={project.color} accentLabel={project.name}>…</Card>
<span style={{ background: tag.color, color: readableTextColor(tag.color) }}>{tag.name}</span>
```

- **`ColorDot`** (`@cubeui/color-dot`) — a round swatch standing in for a category, status or
  tag in a list; `size` is `sm` or `md`. Without `label` it is decoration and hidden from
  assistive tech; with one, the label is its accessible name.
- **`accentColor`** on `Card` draws a left-edge stripe (`@cubeui/color-bar`), normalised so it
  stays visible in both themes, and `accentLabel` names it. Pass it on `Card` rather than placing
  a `ColorBar` yourself — the card owns the `relative overflow-hidden` the stripe needs.
- **`readableTextColor(color)`** (`@cubeui/readable-text-color`) — black or white ink for text on
  a user-chosen backdrop, by WCAG contrast. It does not flip with the theme, because the backdrop
  does not. It returns `undefined` for anything that is not hex, so the text falls back to the
  inherited foreground. Do not hardcode white on a chip: it fails AA on about half of any palette.

## An icon in an input

An icon inside a field is `Input`'s `leading`, on both halves. Do not wrap the input in a
`relative` div with an absolute icon and a `pl-8` on the input:

```tsx
<Input aria-label="Filter servers" placeholder="Filter servers" leading={<Search />} />

<Input
  aria-label="Lane name"
  value={name}
  onChangeText={setName}
  leading={<Pencil />}
  trailing={
    <Button variant="ghost" size="icon-xs" aria-label="Undo rename" onPress={() => setName(saved)}>
      <Undo2 />
    </Button>
  }
  wrapperClassName="w-64"
/>
```

- Pass a bare icon. The input sizes it (`size-4`), mutes it, and pads the text past it. It takes no
  press, so a tap on it lands in the field.
- `trailing` is the far end, inside the field: one icon-sized control. It is pressable, so it
  needs its own name. The text stops short of it.
- `className` stays on the field, as on any input. With a slot, the field sits in a box that is
  `w-full`; size that box with `wrapperClassName`. Without a slot there is no box, and the root is
  the field, as before.
- A search box is not this: it is `SearchInput`, below, which is this plus the name and the ✕.

## Search

A box that filters or searches is `SearchInput`, on both halves. Do not build it from `Input
leading={<Search />}`, and never from a `relative` div, an absolute glyph and a `pl-8`:

```tsx
<SearchInput placeholder="Search servers" value={query} onChangeText={setQuery} />

<SearchInput label="Filter spells" defaultValue={initial} onChangeText={setQuery} wrapperClassName="w-64" />
```

- It is `type="search"`, so a screen reader hears a search field (`role="searchbox"` on device
  too) and a phone raises its search keyboard.
- `label` is its accessible name, default "Search". A placeholder is not a name. `aria-label`
  wins over `label`; a box named by `aria-labelledby` or a `<label htmlFor>` (an `id`, as in
  `FormField`) gets no default, so the visible label is what is read.
- The ✕ shows only while there is text, is a button named `clearLabel` (default "Clear search"),
  empties the box, and puts focus back in it. `clearable={false}` drops it. The browser's own
  ✕ is hidden, so there is one.
- It takes the rest of `Input`'s props except `type`, `leading` and `trailing`: `onChangeText` on
  both halves, and on the web `onChange` too, as a shadcn input does. The ✕ fires both, as if
  the user had cleared the box. Controlled or not, it clears.
- `className` is on the field; size the box with `wrapperClassName`.

### Filter bar

A list page's filter bar is a search box, a select or two, and the buttons that act on the list,
in one wrapping row. There is no component for it — it is one `div`:

```tsx
<div className="flex flex-wrap items-center gap-2">
  <SearchInput placeholder="Search runs" value={query} onChangeText={setQuery} wrapperClassName="w-64" />
  <OptionSelect options={STATUSES} value={status} onValueChange={setStatus} className="w-40" />
  <Button variant="outline" onClick={reset}>Reset</Button>
</div>
```

- `flex-wrap`, so a narrow window stacks the controls rather than squeezing them; `items-center`
  and `gap-2` so a select and a button sit on the search box's line.
- Give the search box and each select a width: both are full width by default, and in a row
  that means one control takes the line.
- Put it above the list, inside the page's content, not in `PageHeader`'s `actions` — those are
  the page's actions, not the list's.

## Removable badge

A tag or filter chip the user can take off is `Badge` with `onRemove`, on both halves:

```tsx
<Badge
  backgroundColor={tag.color}
  textColor={readableTextColor(tag.color)}
  onRemove={() => untag(tag)}
>
  {tag.name}
</Badge>
```

- It draws a trailing ✕ in the label's colour — the variant's, or `textColor` — at the badge's
  icon size. Do not wrap the badge in a second pill with a `Pressable` beside it.
- The ✕ is a button named `removeLabel`, default `Remove <text>`. On the web it is
  `type="button"`, so it never submits a form, and its press stops there: the badge's own
  `onClick` does not fire. The hit area is bigger than the glyph and the pill is no taller.
- The dot (no children) ignores `onRemove`, and so does the web's `asChild`.

## Alert

A callout — a tinted, bordered box saying something about the screen it is on — is `Alert`, on
both halves. Do not hand-draw `rounded-md border border-amber-500/50 bg-amber-500/10` with an icon
and two `<p>`s, and do not reach for `Badge`, which labels a thing rather than explaining it:

```tsx
<Alert
  variant="warning"
  title="Store this token securely"
  description="It will not be shown again."
/>

<Alert
  variant="destructive"
  title="Last error"
  description={server.lastError}
  action={<Button size="sm" variant="outline" onPress={restart}>Restart</Button>}
/>
```

- `variant` is `default` (on the card), `info`, `warning` or `destructive`. It sets the tint, the
  icon and the role — nothing else is coloured: the title and the line under it stay the
  foreground on a tint, because the variant's own hue on its own tint is under 4.5:1. Do not pass
  `text-amber-*` to fix that.
- **Only `destructive` is `role="alert"`**, which interrupts a screen reader. The rest are a polite
  `status`. So a failure the user just caused is `destructive`, and a standing notice — a key shown
  once, a fallback in use, a hint — is `warning` or `info` even when it is urgent-looking.
- `icon` defaults to the variant's glyph (`Info`, `TriangleAlert`, `CircleAlert`). Pass a bare
  `<RefreshCw />` to replace it; the alert sizes it and gives it the variant's ink. `icon={null}`
  draws none.
- `title` and `description` are nodes, so a link can sit inside the description. `action` is the
  far end — one button that deals with it.
- shadcn's compound form also works, so a port can leave its call sites alone:
  `<Alert><CircleAlert /><AlertTitle>…</AlertTitle><AlertDescription>…</AlertDescription></Alert>`.
  The icon child goes into the icon box (and replaces the default glyph); the parts go into the
  column. New code uses the props.
- A failed *fetch* on a list page is `QueryState`'s rung, and a crashed route is `RouteError`;
  `Alert` is for what the screen says while it works.

## Spinner

A loading indicator is `Spinner`, on both halves. Do not import `Loader2` / `LoaderCircle` and add
`animate-spin`, and do not reach for `ActivityIndicator`:

```tsx
<Button disabled={saving} onPress={save}>
  {saving ? <Spinner label="Saving" /> : null}
  <Text>Save</Text>
</Button>

<Spinner label="Loading servers" className="size-6 text-muted-foreground" />
```

- It is `role="status"`, named by `label` (default `Loading`). Name what is loading when more than
  one thing on the screen could be.
- `className` sizes and colours it; the default is `size-4`. On the web the glyph is
  `currentColor`; on native it takes a `Button`'s ink the way any icon there does.
- Both halves draw the same `LoaderCircle`, one turn a second. `ActivityIndicator` is the
  platform's own spinner, a different shape on each.
- A list screen's loading rung is `QueryState`'s `loading`, not a spinner in the middle of it.

## Skeleton

```tsx
<Skeleton className="h-4 w-[250px]" />
<View role="status" aria-label="Loading profile" className="gap-2">
  <Skeleton className="h-4 w-1/3" aria-hidden />
  <Skeleton className="h-3 w-2/3" aria-hidden />
</View>
```

`@cubeui/skeleton`, on both halves: shadcn's placeholder, a rounded `bg-accent` block that pulses
while what it stands in for loads. `className` is its size.

- It pulses on both halves: `animate-pulse` on the web, and on device the same opacity curve
  (down to half and back, two seconds) run by `Animated`. No Reanimated needed.
- It says nothing to assistive tech itself, as shadcn's does not. Hide each block with
  `aria-hidden` and put them in a `role="status"` named for what is loading.
- Reach for a shell's `loading` first. `CardLayout`, `QueryState`, `StatTile`, `PageHeader` and
  the form fields each draw their own skeleton for the part the request fills. `Skeleton` is for a
  part no shell covers.

## Separator

```tsx
<Separator />
<Separator orientation="vertical" />
<Separator decorative={false} />
```

`@cubeui/separator`, on both halves: shadcn's one-pixel rule, `bg-border`, as long as its
container. Use it rather than a `border-b` on the group above or a `h-px` view.

- `orientation` is `horizontal` (the default) or `vertical`. A vertical one fills its row's height:
  `self-stretch` on device, shadcn's `h-full` on the web. Give it a height (`h-4`) when the row is
  taller than the rule should be.
- `decorative` is on by default and hides the rule from assistive tech, since what it divides is
  already divided. `decorative={false}` makes it a `role="separator"`, for a boundary nothing else
  on the screen says.
- On the web it still writes `data-orientation`, so shadcn's
  `className="data-[orientation=vertical]:h-4"` works unchanged; a plain `h-4` works too.
- `Menu` has its own `MenuSeparator`, and `Field` its own `FieldSeparator` with a word in the
  middle. Use those inside them.

## Password

A password or a pasted secret is `PasswordInput`, on both halves. Do not write
`<Input type="password">` with an eye button placed over it by hand.

```tsx
<PasswordInput value={token} onChangeText={setToken} />                  {/* both halves */}
<PasswordInput value={token} onChange={(e) => setToken(e.target.value)} /> {/* web too */}
```

`@cubeui/password-input` installs to `components/password-input`. It is `Input` with
`type="password"` and a show/hide button in its `trailing` slot, so it takes `Input`'s props on
each half — `onChangeText` everywhere, and on the web `onChange`, `name`, `autoComplete` and a ref
to the `<input>` as well. The reveal toggle is behaviour, not a variant, which is why this is a
component and not a `type="password"` prop. Three things a hand-written eye gets wrong, and this
gets right:

- The toggle does not submit. It is `type="button"` on the web, where a bare `<button>` inside a
  `<form>` submits it, so the usual hand-rolled version submits the login form when you ask to see
  what you typed.
- Its accessible name changes with its state — "Show password" / "Hide password", or `showLabel` /
  `hideLabel` — rather than being a fixed "Toggle" that tells a screen reader nothing about what
  will happen.
- It swaps the input's real `type`, not a CSS mask, so a password manager and the browser's own
  autofill still see a password field. On device that `type` is `secureTextEntry`.

`revealable={false}` drops the toggle for a field that should never be shown. `className` is the
field's and `wrapperClassName` the box around the field and its eye. `leading` still takes an icon.

## Theme

```tsx
// Web: nothing to pass. The picker stores the choice and applies it.
<ThemePicker />

// A sidebar footer or a header bar: one full-width row of icon-only radios.
<ThemePicker variant="compact" />

// Device: pass storage once, where the app starts. The picker writes through it too.
import AsyncStorage from "@react-native-async-storage/async-storage";
useThemePreference({ storage: AsyncStorage });
```

`@cubeui/theme-picker` works on both platforms. `ThemePicker` is a `RadioGroup variant="card"`
with Light, Dark and System. Do not hand-roll it from `RadioGroup`. The control is the easy part,
and the storage, the class and the first paint are what hand-rolled versions get wrong.

- **Bound by default.** Without `value`, the picker reads and writes `useThemePreference()`.
  Pass `value` and it is controlled. It then only calls `onValueChange` and never touches storage,
  the class or `Appearance`. Use that when the preference lives on the account or in a settings
  form.
- **Call `useThemePreference()` at the app's root as well**, not only on the settings screen. That
  way the choice is applied on every screen, and System keeps following the device. It returns
  `[preference, setPreference]`, the same state the picker shows.
- **Web:** the choice goes in `localStorage` under `THEME_STORAGE_KEY` (`"cubeui-theme"`). It is
  applied as a class on `<html>`: `dark` for Dark, `light` for Light, and for System `dark` only
  while the device is dark. A DOM app's `tokens.web.css` has only `.dark`, which is why System
  still sets it. The hook reads nothing at import, so it renders on a server.
- **Device:** the choice is applied with `Appearance.setColorScheme`, with `"unspecified"` for System. That
  is the spelling React Native 0.82+ requires, and 0.81 treats it the same way.
  `storage` is any `{ getItem, setItem }`, sync or async. Wrap MMKV or `expo-secure-store` in two
  lambdas. Without `storage` the choice lasts until the app closes. The stored value is read
  asynchronously, so hold the splash screen if a flash of the system theme matters.
- **`variant="compact"`** is for where tiles do not fit, such as a 14rem sidebar footer or a 6rem
  phone header. It draws one row of Sun / Moon / Monitor segments (`RadioGroup
  variant="segmented"`) and fills its container's width, so size the container, not the picker.
  It is still a radiogroup of three radios with the same keyboard and the same `value` /
  `onValueChange` or hook binding. Each caption ("Light", "Dark", "System") is the radio's
  `aria-label`, and on the web it is also the hover tooltip (`title`). A device has no hover, so
  there the caption is only the name VoiceOver and TalkBack read. Do not hand-draw an icon-only
  theme `<fieldset>` beside it.
- `aria-label` defaults to "Theme". Pass `aria-labelledby` when a heading names the group.

### Palettes

A palette is a second choice beside the theme: whose colours, where the theme is light or dark.
`PALETTE_PREFERENCES` lists them — `"default"` (cubeui's own) and `"monokai"`. Monokai is dark
only, so it is in `DARK_ONLY_PALETTES`, and while it is chosen the app is dark whatever the theme
says.

- **`<ThemePicker palettes={PALETTE_PREFERENCES} />`** adds a Palette radiogroup under the
  theme. While a dark-only palette is chosen the theme radios are disabled, and they come back
  as they were when Default is chosen again. Controlled, it takes `palette` and
  `onPaletteChange` beside `value` and `onValueChange`.
- **`usePalettePreference()`** returns `[palette, setPalette]`, for a control of your own. It
  takes the same `storage` as `useThemePreference`.
- **Web:** stored under `PALETTE_STORAGE_KEY` (`"cubeui-palette"`) and applied as
  `data-palette="monokai"` on `<html>`, which the tokens stylesheet keys on. The pre-paint
  script below reads it too. `useThemePreference()` at the root applies both.
- **Device:** there is no `<html>`, so wrap the app's root in **`PaletteProvider`**, inside
  nothing that draws. It hands the palette's colours to NativeWind's `VariableContextProvider`,
  so they reach a `Modal` too, and a dark-only palette also sets `Appearance` to dark. On the
  web `PaletteProvider` renders its children and nothing more, so one root serves both.
- **A checked, pressed or current control is drawn in `selection`**, not `primary`: blue in the
  default palette, Monokai's purple in Monokai. A selected state you draw yourself uses
  `bg-selection` and `text-selection-foreground` too, so it follows the palette; `primary` stays
  the colour of a button to press. The active tab and the sidebar's current row are `selection`
  too. Hover is grey and never `selection`: `hover:bg-accent` on a control, `hover:bg-muted` on a
  row with muted text in it. A chosen card is ringed with `border-selection`, not filled.
- The colours are in `palettes` in `@/lib/cubeui-theme`; `paletteFor(scheme, palette)` gives the
  set a screen is painted with, for a chart or anything else that takes a colour as a prop.

```tsx
const storage = { getItem: (k) => mmkv.getString(k) ?? null, setItem: (k, v) => mmkv.set(k, v) };

export default function Root() {
  useThemePreference({ storage });
  usePalettePreference({ storage });
  return (
    <PaletteProvider>
      <Stack />
    </PaletteProvider>
  );
}
```

**Paint the stored theme and palette before React mounts**, or a reload flashes the other one. Put this in
`<head>`, before any stylesheet:

```html
<script>(function(){try{var s=localStorage,p=s.getItem("cubeui-theme"),q=s.getItem("cubeui-palette"),k=["monokai"].indexOf(q)>=0,d=k||p==="dark"||(p!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches),e=document.documentElement,c=e.classList;c.toggle("dark",d);c.toggle("light",!k&&p==="light");if(["monokai"].indexOf(q)>=0)e.setAttribute("data-palette",q)}catch(e){}})();</script>
```

Where the head is React, as in Expo's `app/+html.tsx` or a Next layout, render the export rather
than pasting it:

```tsx
import { THEME_PRE_PAINT_SCRIPT } from "@/components/ui/theme-preference-base";

<script dangerouslySetInnerHTML={{ __html: THEME_PRE_PAINT_SCRIPT }} />
```

## File picker

A file the user uploads, read as text, is `FilePicker`: a drop zone over a hidden file input.

```tsx
<FilePicker
  label="Upload notes"
  hint="Drop .md files, or click to choose"
  accept=".md,text/markdown"
  multiple
  onPickMany={(files) => upload(files)} // [{ text, name }, ...]
/>
```

- The caller gets each file's decoded text and its name, never a `File`, so the calling screen
  is the same on both halves.
- `onPick(text, name)` is one file. `onPickMany(files)` is one call for the whole pick. Pass
  either one, or both. If `onPickMany` is there, `onPick` is not called. With `multiple` and
  only `onPick`, `onPick` is called once for each file, in order.
- `multiple` lets the dialog select several files and keeps every file in a drop. Without it, a
  pick is one file, and a drop keeps the first file that `accept` allows.
- `accept` takes the syntax of `<input accept>`: `.ext`, `type/*` or `type/subtype`. It applies
  to drops as well as the dialog. A file that does not match is skipped and never read. List the
  extension as well as the MIME type, because browsers often give `.md` and similar files no
  type at all.

### As a button

Where a drop zone does not fit, such as a page header's actions or a toolbar, use
`FilePickerButton` from the same item. It takes the same picking props and opens the file dialog
directly, so you do not need a dialog around a zone.

```tsx
<PageHeader
  title="Notes"
  action={
    <FilePickerButton
      variant="ghost"
      size="icon-sm"
      label="Upload notes"
      accept=".md"
      multiple
      onPickMany={upload}
    />
  }
/>
```

- `variant` and `size` are the `Button`'s and are forwarded to it. At an `icon*` size only the
  icon is drawn. At any other size the label is drawn after the icon.
- `label` is required and is always the accessible name.
- `icon` defaults to the upload glyph. Pass a bare `<Plus />` to change it. The button sizes and
  colours it.
- It still takes a file dropped onto it, and shows a ring while something is dragged over it.
- It is a separate component rather than `variant="button"` on `FilePicker`. `variant` already
  means the button's look, and one prop cannot also choose between two shapes.

- **Native:** `@cubeui/file-picker` installs, and both components take the same props, but they
  do not pick. `FilePicker` draws the zone and says on screen that picking is web only.
  `FilePickerButton` draws the button disabled and gives the same reason as its accessibility
  hint. See `SKILL.md`'s last section.
